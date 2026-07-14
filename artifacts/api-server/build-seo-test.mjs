// Bundles the SEO test harness the SAME way the app is built (esbuild, pino plugin, same externals),
// so the test exercises the real bundled code path. Output: dist-test/seo-test-entry.mjs
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";

globalThis.require = createRequire(import.meta.url);
const artifactDir = path.dirname(fileURLToPath(import.meta.url));

await esbuild({
  entryPoints: [path.resolve(artifactDir, "src/seo-test-entry.ts")],
  platform: "node",
  bundle: true,
  format: "esm",
  outdir: path.resolve(artifactDir, "dist-test"),
  outExtension: { ".js": ".mjs" },
  logLevel: "info",
  external: [
    "*.node", "@anthropic-ai/claude-agent-sdk", "sharp", "better-sqlite3", "sqlite3", "canvas", "bcrypt",
    "argon2", "fsevents", "re2", "farmhash", "xxhash-addon", "bufferutil", "utf-8-validate", "ssh2",
    "cpu-features", "dtrace-provider", "isolated-vm", "lightningcss", "pg-native", "oracledb",
    "mongodb-client-encryption", "nodemailer", "handlebars", "knex", "typeorm", "protobufjs",
    "onnxruntime-node", "@tensorflow/*", "@prisma/client", "@mikro-orm/*", "@grpc/*", "@swc/*",
    "@aws-sdk/*", "@azure/*", "@opentelemetry/*", "@google-cloud/*", "@google/*", "googleapis",
    "firebase-admin", "@parcel/watcher", "@sentry/profiling-node", "@tree-sitter/*", "aws-sdk",
    "classic-level", "dd-trace", "ffi-napi", "grpc", "hiredis", "kerberos", "leveldown", "miniflare",
    "mysql2", "newrelic", "odbc", "piscina", "realm", "ref-napi", "rocksdb", "sass-embedded",
    "sequelize", "serialport", "snappy", "tinypool", "usb", "workerd", "wrangler", "zeromq",
    "zeromq-prebuilt", "playwright", "puppeteer", "puppeteer-core", "electron",
  ],
  sourcemap: "linked",
  plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
  banner: {
    js: `import { createRequire as __cr } from 'node:module';\nimport __p from 'node:path';\nimport __u from 'node:url';\nglobalThis.require = __cr(import.meta.url);\nglobalThis.__filename = __u.fileURLToPath(import.meta.url);\nglobalThis.__dirname = __p.dirname(globalThis.__filename);`,
  },
});
console.log("built dist-test/seo-test-entry.mjs");
