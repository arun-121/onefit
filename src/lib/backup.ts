/**
 * Export and restore of everything the app stores: food entries, saved foods, workouts,
 * weigh-ins and settings, as one JSON file. The Groq API key is never included; it lives in the
 * phone's secure storage and is not part of the settings. Two facts about this phone are also
 * left out, and kept as they are by a restore: whether it has been asked to allow notifications,
 * and which weigh-ins from other apps were deleted here.
 *
 * Restoring is all or nothing: the file is checked in full first, and the swap happens inside a
 * single database transaction, so a bad file or a failure halfway leaves the phone as it was.
 */
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import {
  backupFileName,
  keepPhoneState,
  makeBackupFile,
  summarizeBackup,
  validateBackup,
  type BackupFile,
  type BackupSummary,
} from './backup-format';
import { getAllEntries, getAllExercises, getAllFoods, getAllWeights, notifyChanged, replaceAllData } from './db';
import { deleteOwnRecords, getHealthGrants, type OwnRecordType } from './health';
import { DISMISSED_WEIGHTS_KEY, getDismissedWeightDates, syncHealthBackfill } from './logging';
import { rescheduleReminders } from './reminders';
import { getSettings, SETTINGS_KEY, updateSettings } from './settings';
import { refreshWidgets } from '../widget/refresh';

export { BACKUP_APP, BACKUP_FORMAT, backupFileName, describeBackup, keepPhoneState, summarizeBackup, validateBackup } from './backup-format';
export type { BackupCheck, BackupData, BackupFile, BackupSummary, KeptPhoneState, PhoneState } from './backup-format';

/** Far larger than years of logging; anything bigger is not one of our backups. */
const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

/** Everything on this phone, as a backup object ready to be written to a file. */
export function buildBackup(now: Date = new Date()): BackupFile {
  return makeBackupFile(
    {
      entries: getAllEntries(),
      foods: getAllFoods(),
      exercises: getAllExercises(),
      weights: getAllWeights(),
      settings: getSettings(),
    },
    now,
  );
}

// ---------------------------------------------------------------- Health Connect bookkeeping

type HealthIds = Record<OwnRecordType, Set<string>>;

/** The Health Connect records this app wrote for a set of rows. Imported weigh-ins belong to other apps. */
function ownHealthIds(data: Pick<BackupFile['data'], 'entries' | 'exercises' | 'weights'>): HealthIds {
  const ids: HealthIds = { Nutrition: new Set(), ExerciseSession: new Set(), ActiveCaloriesBurned: new Set(), Weight: new Set() };
  for (const e of data.entries) if (e.hcRecordId) ids.Nutrition.add(e.hcRecordId);
  for (const x of data.exercises) {
    if (x.hcSessionId) ids.ExerciseSession.add(x.hcSessionId);
    if (x.hcCaloriesId) ids.ActiveCaloriesBurned.add(x.hcCaloriesId);
  }
  for (const w of data.weights) if (w.source === 'manual' && w.hcRecordId) ids.Weight.add(w.hcRecordId);
  return ids;
}

function currentHealthIds(): HealthIds {
  return ownHealthIds({ entries: getAllEntries(), exercises: getAllExercises(), weights: getAllWeights() });
}

// ---------------------------------------------------------------- restore

/**
 * Replace everything on this phone with a backup, inside ONE transaction, then tell the screens.
 * The backup is checked again here, so a file that fails validation can never get this far; it
 * throws instead and nothing changes.
 *
 * A row keeps its Health Connect id only when this phone already knows that record. Ids from
 * another phone, or for records that were replaced since the backup, would point at nothing, so
 * they are cleared and the usual backfill writes the last week again.
 *
 * Two things are carried across from this phone rather than taken from the file (see
 * `keepPhoneState`): whether it has been asked about notifications, and the days whose imported
 * weigh-in was deleted here, which the sync after the restore would otherwise bring back. The
 * widget's "last log" note is dropped on purpose: its entry ids would point at restored rows.
 *
 * This is the database step only. Screens should call `restoreFromBackup`, which also brings
 * Health Connect, the widgets and the reminders back in step.
 */
export function restoreBackup(payload: BackupFile): BackupSummary {
  const check = validateBackup(payload);
  if (!check.ok) throw new Error(check.problems[0] ?? 'This file is not a Calorie Tracker backup.');
  const { data } = check.backup;
  const known = currentHealthIds();
  const keep = (type: OwnRecordType, id: string | null) => (id !== null && known[type].has(id) ? id : null);
  // Read before the swap: replaceAllData empties the key/value table along with everything else.
  const phone = keepPhoneState(data, { settings: getSettings(), dismissedWeightDates: getDismissedWeightDates() });

  replaceAllData({
    entries: data.entries.map((e) => ({ ...e, hcRecordId: keep('Nutrition', e.hcRecordId) })),
    foods: data.foods,
    exercises: data.exercises.map((x) => {
      const hcSessionId = keep('ExerciseSession', x.hcSessionId);
      // A workout is written as a pair; without its session it counts as not written.
      return { ...x, hcSessionId, hcCaloriesId: hcSessionId === null ? null : keep('ActiveCaloriesBurned', x.hcCaloriesId) };
    }),
    weights: data.weights.map((w) => (w.source === 'manual' ? { ...w, hcRecordId: keep('Weight', w.hcRecordId) } : w)),
    kv: { [SETTINGS_KEY]: phone.settings, [DISMISSED_WEIGHTS_KEY]: phone.dismissedWeightDates },
  });
  notifyChanged();
  return summarizeBackup(check.backup);
}

/** Records this phone wrote that no longer belong to any row after the restore. */
async function removeOrphanedHealthRecords(before: HealthIds, after: HealthIds): Promise<void> {
  for (const type of Object.keys(before) as OwnRecordType[]) {
    const orphans = [...before[type]].filter((id) => !after[type].has(id));
    try {
      await deleteOwnRecords(type, orphans);
    } catch (e) {
      console.warn(`Could not remove old ${type} records from Health Connect`, e);
    }
  }
}

/**
 * Restore a checked backup and bring everything else back in step: Health Connect loses the
 * records of rows that no longer exist and gets the last week written again, the widgets redraw
 * and the reminders are rebuilt. Resolves once the data is replaced and the widgets and
 * reminders are done; the Health Connect tidy-up carries on in the background.
 *
 * Call it only after the owner has confirmed ("This replaces everything on this phone").
 * Throws, changing nothing, if the backup does not pass validation.
 */
export async function restoreFromBackup(payload: BackupFile): Promise<BackupSummary> {
  const wasSyncing = getSettings().healthConnectEnabled;
  const before = currentHealthIds();
  const summary = restoreBackup(payload);
  const after = currentHealthIds();

  // The backup may come from a phone where Health Connect was on; here it may never have been allowed.
  if (getSettings().healthConnectEnabled) {
    const grants = await getHealthGrants().catch(() => null);
    if (!grants?.writeNutrition) updateSettings({ healthConnectEnabled: false });
  }

  await Promise.allSettled([refreshWidgets(), rescheduleReminders()]);

  // Orphans first: a record being rewritten must not collide with the one it replaces.
  void (async () => {
    if (wasSyncing) await removeOrphanedHealthRecords(before, after);
    await syncHealthBackfill();
  })().catch((e) => console.warn('Health Connect sync after restore failed', e));

  return summary;
}

// ---------------------------------------------------------------- files

export interface ExportedBackup {
  fileName: string;
  summary: BackupSummary;
}

/**
 * Write the backup to a JSON file in the cache folder and open Android's share sheet, where the
 * owner picks Drive, Files, email and so on. Resolves when the sheet closes; Android does not
 * say whether something was chosen. Throws with a plain message if the file cannot be written
 * or shared.
 */
export async function exportBackupFile(): Promise<ExportedBackup> {
  const now = new Date();
  const backup = buildBackup(now);
  const fileName = backupFileName(now);
  let file: File;
  try {
    file = new File(Paths.cache, fileName);
    file.create({ overwrite: true });
    await file.write(JSON.stringify(backup));
  } catch (e) {
    console.warn('Could not write the backup file', e);
    throw new Error('The backup file could not be written. Free up some space and try again.');
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this phone.');
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Save your backup' });
  return { fileName, summary: summarizeBackup(backup) };
}

export type PickedFile = { canceled: true } | { canceled: false; fileName: string; contents: unknown };

/**
 * Let the owner choose a backup file and return what is in it, parsed but not yet checked: pass
 * `contents` to `validateBackup`. Throws with a plain message when the file cannot be read or is
 * not JSON.
 */
export async function pickBackupFile(): Promise<PickedFile> {
  const result = await DocumentPicker.getDocumentAsync({
    // Backups are .json, but file managers and cloud drives do not agree on what to call that.
    type: ['application/json', 'text/plain', 'application/octet-stream'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || result.assets.length === 0) return { canceled: true };
  const asset = result.assets[0];
  const copy = new File(asset.uri);
  try {
    if ((asset.size ?? 0) > MAX_BACKUP_BYTES) throw new Error('That file is too large to be a Calorie Tracker backup.');
    let text: string;
    try {
      text = await copy.text();
    } catch (e) {
      console.warn('Could not read the picked file', e);
      throw new Error('That file could not be opened. Try choosing it again.');
    }
    try {
      return { canceled: false, fileName: asset.name, contents: JSON.parse(text) as unknown };
    } catch {
      throw new Error('That file is not a Calorie Tracker backup. Choose the .json file that Export backup made.');
    }
  } finally {
    // The picker left a copy in the cache; it has been read, so it can go.
    try {
      if (copy.exists) copy.delete();
    } catch {
      // Android clears the cache on its own.
    }
  }
}

export type PickedBackup =
  | { status: 'canceled' }
  /** The file is not a backup this app can restore. Nothing was changed. */
  | { status: 'invalid'; fileName: string | null; problems: string[] }
  | { status: 'ok'; fileName: string; backup: BackupFile; summary: BackupSummary };

/**
 * Choose a file and check it in one step. On 'ok', confirm with the owner, then call
 * `restoreFromBackup(backup)`. On 'invalid', show `problems`; nothing has been touched.
 */
export async function pickAndCheckBackup(): Promise<PickedBackup> {
  let picked: PickedFile;
  try {
    picked = await pickBackupFile();
  } catch (e) {
    return { status: 'invalid', fileName: null, problems: [e instanceof Error ? e.message : 'That file could not be opened.'] };
  }
  if (picked.canceled) return { status: 'canceled' };
  const check = validateBackup(picked.contents);
  return check.ok
    ? { status: 'ok', fileName: picked.fileName, backup: check.backup, summary: check.summary }
    : { status: 'invalid', fileName: picked.fileName, problems: check.problems };
}
