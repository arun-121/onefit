// Keep Metro from crawling agent/tooling folders (skills get rewritten while Metro runs).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const existing = config.resolver.blockList;
const base = Array.isArray(existing) ? existing : existing ? [existing] : [];
config.resolver.blockList = [...base, /[/\\]\.claude[/\\].*/, /[/\\]\.agents[/\\].*/, /[/\\]screenshots[/\\].*/];

module.exports = config;
