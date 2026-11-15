import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText, Avatar, Button, Chip, IconButton, ScreenHeader } from '@/components/ui';
import { Shape, Spacing, Type, withAlpha } from '@/constants/theme';
import { useLiveQuery, useToday } from '@/hooks/use-live-query';
import { useTheme } from '@/hooks/use-theme';
import { assistantSystemPrompt, cleanReply, historyForModel, STARTER_QUESTIONS, type ChatMessage } from '@/lib/assistant';
import { loadAssistantDigest, loadChat, saveChat } from '@/lib/assistant-data';
import { askAssistant, getApiKey, GroqError } from '@/lib/groq';
import { getSettings } from '@/lib/settings';

/** A message stamped with the time it was made. */
function message(role: ChatMessage['role'], text: string, error = false): ChatMessage {
  return error ? { role, text, at: Date.now(), error } : { role, text, at: Date.now() };
}

/**
 * The Assistant tab: questions about the owner's own food, weight and training, answered by the AI
 * model in Settings from a summary of the logs (see `assistant.ts`). The data stays in SQLite on the
 * phone; each question sends the summary with it. The conversation is kept between app runs.
 */
export default function AssistantScreen() {
  const { colors } = useTheme();
  const { navigate } = useRouter();
  const today = useToday();
  const settings = useLiveQuery(getSettings, []);
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadChat());
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  // The key can be added in Settings while this tab is open in the background.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      void getApiKey().then((k) => live && setHasKey(!!k));
      return () => {
        live = false;
      };
    }, []),
  );

  const ask = async (text: string, before: ChatMessage[] = messages) => {
    const question = text.trim();
    if (!question || busy) return;
    const asked: ChatMessage[] = [...before.filter((m) => !m.error), message('user', question)];
    setMessages(asked);
    saveChat(asked);
    setDraft('');
    setBusy(true);
    try {
      const system = assistantSystemPrompt(loadAssistantDigest(today));
      const reply = await askAssistant(settings.textModel, system, historyForModel(asked));
      const answered: ChatMessage[] = [...asked, message('assistant', cleanReply(reply))];
      setMessages(answered);
      saveChat(answered);
    } catch (e) {
      const text = e instanceof GroqError ? e.message : 'Something went wrong. Try again.';
      setMessages([...asked, message('assistant', text, true)]);
    } finally {
      setBusy(false);
    }
  };

  // Asks the last question again, in place of the answer that failed.
  const retry = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    const upTo = messages.slice(0, messages.lastIndexOf(lastUser));
    void ask(lastUser.text, upTo);
  };

  const clear = () => {
    setMessages([]);
    saveChat([]);
  };

  const canSend = draft.trim().length > 0 && !busy && hasKey !== false;

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <KeyboardAvoidingView style={styles.screen} behavior="padding">
        <ScrollView
          ref={scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
          <ScreenHeader
            title="Assistant"
            supporting="Knows your last 30 days"
            trailing={messages.length ? <IconButton icon="delete-sweep-outline" label="Clear the conversation" onPress={clear} /> : null}
          />

          {hasKey === false ? (
            <View style={[styles.intro, { backgroundColor: colors.surfaceContainerHigh }]}>
              <AppText variant="titleMedium" emphasized>
                Add your Groq API key
              </AppText>
              <AppText variant="bodyMedium" color={colors.onSurfaceVariant}>
                The assistant answers through Groq, the same as food logging. Add the key in Settings to ask questions.
              </AppText>
              <Button title="Open Settings" variant="tonal" onPress={() => navigate('/settings')} style={styles.end} />
            </View>
          ) : null}

          {messages.length === 0 ? (
            <View style={styles.empty}>
              <View style={[styles.intro, { backgroundColor: colors.primaryContainer }]}>
                <Avatar icon="auto-fix" tint={colors.onPrimaryContainer} />
                <AppText variant="titleLarge" emphasized color={colors.onPrimaryContainer}>
                  Ask about your food, weight and training
                </AppText>
                <AppText variant="bodyMedium" color={colors.onPrimaryContainer}>
                  Answers come from your own logs: what you eat, how your weight is moving and what you really burn. Your
                  logs stay on this phone; each question sends a summary of them to Groq.
                </AppText>
              </View>
              <View style={styles.starters}>
                {STARTER_QUESTIONS.map((q) => (
                  <Chip key={q} kind="suggestion" label={q} onPress={() => void ask(q)} />
                ))}
              </View>
            </View>
          ) : (
            <View style={styles.thread}>
              {messages.map((m, i) =>
                m.role === 'user' ? (
                  <View key={`${m.at}-${i}`} style={[styles.question, { backgroundColor: colors.secondaryContainer }]}>
                    <AppText variant="bodyLarge" color={colors.onSecondaryContainer}>
                      {m.text}
                    </AppText>
                  </View>
                ) : m.error ? (
                  <View key={`${m.at}-${i}`} style={[styles.failed, { backgroundColor: colors.errorContainer }]}>
                    <AppText variant="bodyMedium" color={colors.onErrorContainer}>
                      {m.text}
                    </AppText>
                    {i === messages.length - 1 ? <Button title="Try again" variant="text" icon="refresh" onPress={retry} style={styles.end} /> : null}
                  </View>
                ) : (
                  <View key={`${m.at}-${i}`} style={styles.answer}>
                    <Avatar icon="auto-fix" tone="secondary" size={32} />
                    <AppText variant="bodyLarge" style={styles.answerText} selectable>
                      {m.text}
                    </AppText>
                  </View>
                ),
              )}
              {busy ? (
                <View style={styles.answer}>
                  <Avatar icon="auto-fix" tone="secondary" size={32} />
                  <View style={styles.thinking}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <AppText variant="bodyMedium" color={colors.onSurfaceVariant}>
                      Looking at your logs
                    </AppText>
                  </View>
                </View>
              ) : null}
            </View>
          )}
        </ScrollView>

        <View style={[styles.bar, { backgroundColor: colors.surface }]}>
          <View style={[styles.field, { backgroundColor: colors.surfaceContainerHigh }]}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Ask anything about your fitness"
              placeholderTextColor={withAlpha(colors.onSurfaceVariant, 0.7)}
              selectionColor={withAlpha(colors.primary, 0.4)}
              cursorColor={colors.primary}
              multiline
              editable={hasKey !== false}
              accessibilityLabel="Question for the assistant"
              style={[Type.bodyLarge, styles.input, { color: colors.onSurface }]}
            />
          </View>
          <View style={styles.send}>
            <IconButton icon="send" label="Send" variant="filled" disabled={!canSend} onPress={() => void ask(draft)} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xl, gap: Spacing.lg, flexGrow: 1 },
  empty: { gap: Spacing.lg },
  intro: { borderRadius: Shape.extraLarge, padding: Spacing.xl, gap: Spacing.md },
  starters: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  thread: { gap: Spacing.xl },
  question: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Shape.largeIncreased,
    borderBottomRightRadius: Shape.extraSmall,
  },
  answer: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  answerText: { flex: 1, paddingTop: Spacing.xs },
  thinking: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', paddingTop: Spacing.xs },
  failed: { borderRadius: Shape.large, padding: Spacing.lg, gap: Spacing.xs },
  end: { alignSelf: 'flex-end' },
  bar: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  field: { flex: 1, minHeight: 56, maxHeight: 140, borderRadius: Shape.extraLarge, paddingHorizontal: Spacing.xl, justifyContent: 'center' },
  input: { paddingVertical: Spacing.md, padding: 0 },
  // Centres the 48dp button on the 56dp field's single line, and keeps it at the bottom as the field grows.
  send: { paddingBottom: Spacing.xs },
});
