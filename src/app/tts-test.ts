import { resolve } from "node:path";
import { stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { createVoiceOutput } from "../voice/createVoiceOutput.ts";
import {
  parseOptionalNumber,
  parseTtsGender,
  parseTtsLanguage,
  parseTtsProvider,
  parseTtsRate,
  resolveTtsConfig,
  type TtsCliOptions
} from "../voice/TtsConfig.ts";
import { MacosAppleTtsProvider } from "../voice/MacosAppleTtsProvider.ts";
import type { VoiceMessage } from "../voice/VoiceMessage.ts";

export interface TtsTestCliOptions {
  tts: TtsCliOptions;
  texts: Array<{
    language: VoiceMessage["language"];
    text: string;
  }>;
  listVoices: boolean;
}

export async function runTtsTest(args = process.argv.slice(2)): Promise<void> {
  const cli = parseTtsTestCliArgs(args);
  const writeLine = (line: string): void => {
    stdout.write(`${line}\n`);
  };

  if (cli.listVoices) {
    const provider = new MacosAppleTtsProvider();
    const voices = await provider.listVoices();
    for (const voice of voices) {
      writeLine(`${voice.language}\t${voice.gender ?? "auto"}\t${voice.name}\t${voice.identifier}`);
    }
    return;
  }

  const cliTts = {
    enabled: true,
    ...cli.tts
  };
  const resolvedTts = resolveTtsConfig({
    cli: cliTts
  });
  const output = createVoiceOutput({
    cli: {
      ...cliTts
    },
    writeLine
  });

  writeLine("[tts:test] starting");
  writeLine(`[tts:test] provider=${resolvedTts.provider} language=${resolvedTts.language} voice=${resolvedTts.voiceName ?? "auto"} rate=${resolvedTts.rate}`);

  for (const sample of cli.texts) {
    await output.speak({
      id: `tts_test_${sample.language}`,
      text: sample.text,
      language: sample.language,
      priority: "normal",
      interruptible: true,
      category: "status"
    });
  }

  await output.stop();
  writeLine("[tts:test] done");
}

export function parseTtsTestCliArgs(args: string[]): TtsTestCliOptions {
  const tts: TtsCliOptions = {
    enabled: true
  };
  const texts: TtsTestCliOptions["texts"] = [];
  let listVoices = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case "--text":
        texts.push({
          language: "ko",
          text: requiredValue(args, ++index, "--text")
        });
        break;
      case "--ko":
        texts.push({
          language: "ko",
          text: requiredValue(args, ++index, "--ko")
        });
        break;
      case "--en":
        texts.push({
          language: "en",
          text: requiredValue(args, ++index, "--en")
        });
        break;
      case "--list-voices":
        listVoices = true;
        break;
      case "--tts-provider":
      case "--provider":
        tts.provider = parseRequiredProvider(requiredValue(args, ++index, arg));
        break;
      case "--tts-voice":
      case "--voice":
        tts.voiceName = requiredValue(args, ++index, arg);
        break;
      case "--tts-gender":
      case "--gender":
        tts.gender = parseRequiredGender(requiredValue(args, ++index, arg));
        break;
      case "--tts-rate":
      case "--rate":
        tts.rate = parseRequiredRate(requiredValue(args, ++index, arg));
        break;
      case "--tts-language":
      case "--language":
        tts.language = parseRequiredLanguage(requiredValue(args, ++index, arg));
        break;
      case "--tts-pitch":
      case "--pitch":
        tts.pitch = parseRequiredNumber(requiredValue(args, ++index, arg), arg);
        break;
      case "--tts-volume":
      case "--volume":
        tts.volume = parseRequiredNumber(requiredValue(args, ++index, arg), arg);
        break;
      default:
        texts.push({
          language: detectSampleLanguage(arg),
          text: arg
        });
    }
  }

  if (texts.length === 0 && !listVoices) {
    texts.push(
      {
        language: "ko",
        text: "코덱스 음성 출력 테스트야."
      },
      {
        language: "en",
        text: "Codex text to speech test complete."
      }
    );
  }

  return {
    tts,
    texts,
    listVoices
  };
}

function detectSampleLanguage(text: string): VoiceMessage["language"] {
  return /[ㄱ-ㅎㅏ-ㅣ가-힣]/u.test(text) ? "ko" : "en";
}

function requiredValue(args: string[], index: number, option: string): string {
  const value = args[index];
  if (!value) throw new Error(`${option} requires a value.`);
  return value;
}

function parseRequiredProvider(value: string): NonNullable<TtsCliOptions["provider"]> {
  const provider = parseTtsProvider(value);
  if (!provider) throw new Error(`Unsupported TTS provider: ${value}.`);
  return provider;
}

function parseRequiredGender(value: string): NonNullable<TtsCliOptions["gender"]> {
  const gender = parseTtsGender(value);
  if (!gender) throw new Error(`Unsupported TTS gender: ${value}.`);
  return gender;
}

function parseRequiredLanguage(value: string): NonNullable<TtsCliOptions["language"]> {
  const language = parseTtsLanguage(value);
  if (!language) throw new Error(`Unsupported TTS language: ${value}.`);
  return language;
}

function parseRequiredRate(value: string): number {
  const rate = parseTtsRate(value);
  if (rate === undefined) throw new Error(`Unsupported TTS rate: ${value}.`);
  return rate;
}

function parseRequiredNumber(value: string, option: string): number {
  const parsed = parseOptionalNumber(value);
  if (parsed === undefined) throw new Error(`${option} requires a numeric value.`);
  return parsed;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDirectEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  return fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

if (isDirectEntrypoint()) {
  runTtsTest().catch((error: unknown) => {
    stderr.write(`[tts:test:fatal] ${formatError(error)}\n`);
    process.exitCode = 1;
  });
}
