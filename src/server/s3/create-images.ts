import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "@/env";

function s3Config() {
  const bucket = env.S3_BUCKET;
  const region = env.S3_REGION;
  const accessKeyId = env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY;
  if (!bucket || !region || !accessKeyId || !secretAccessKey) return null;
  return {
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    ttl: env.S3_SIGNED_URL_TTL ?? 3600,
    prefix: (env.S3_KEY_PREFIX ?? "create").replace(/^\/+|\/+$/g, ""),
  };
}

export function isS3Configured(): boolean {
  return s3Config() != null;
}

function clientFor(cfg: NonNullable<ReturnType<typeof s3Config>>) {
  return new S3Client({
    region: cfg.region,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
}

export function createImageKey(opts: {
  accountId: string;
  chatId: string;
  imageId: string;
  ext?: string;
}) {
  const cfg = s3Config();
  if (!cfg) throw new Error("S3 is not configured");
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 128);
  const ext = (opts.ext ?? "png").replace(/^\./, "");
  return `${cfg.prefix}/${safe(opts.accountId)}/${safe(opts.chatId)}/${safe(opts.imageId)}.${ext}`;
}

function parseDataUrl(dataUrl: string): { contentType: string; body: Buffer } {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match?.[1] || !match[2]) {
    throw new Error("Expected a base64 data URL for S3 upload");
  }
  return {
    contentType: match[1],
    body: Buffer.from(match[2], "base64"),
  };
}

export async function putCreateImage(opts: {
  accountId: string;
  chatId: string;
  imageId: string;
  dataUrl: string;
}): Promise<{ key: string; url: string }> {
  const cfg = s3Config();
  if (!cfg) throw new Error("S3 is not configured");

  const { contentType, body } = parseDataUrl(opts.dataUrl);
  const ext = contentType.includes("jpeg") || contentType.includes("jpg")
    ? "jpg"
    : contentType.includes("webp")
      ? "webp"
      : "png";
  const key = createImageKey({ ...opts, ext });
  const client = clientFor(cfg);

  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "private, max-age=31536000",
    }),
  );

  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
    { expiresIn: cfg.ttl },
  );

  return { key, url };
}

export async function signCreateImageUrl(key: string): Promise<string> {
  const cfg = s3Config();
  if (!cfg) throw new Error("S3 is not configured");
  const client = clientFor(cfg);
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
    { expiresIn: cfg.ttl },
  );
}
