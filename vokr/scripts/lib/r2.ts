/**
 * Cloudflare R2 through its S3-compatible API — used only by operator
 * scripts (asset upload, backups), never by the app at runtime (plan §5
 * Phase 14 security: R2 credentials are server-only, upload/backup only).
 *
 * Every caller is dry-run unless it passes `{ apply: true }`, and a dry run
 * needs no credentials at all: it prints what it would do.
 *
 * Integrity is checked by reading objects back and hashing them, not by
 * S3 checksum headers: R2's compatibility table documents SHA-256 and
 * CRC-32 only as multipart (composite) checksums, so the client sends a
 * checksum only where the API requires one (`WHEN_REQUIRED`), and objects
 * are removed with single `DeleteObject` calls rather than the batch
 * `DeleteObjects`, whose required checksum header R2 does not document.
 */
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Test-only S3-compatible endpoint (a local MinIO); see {@link endpointOverride}. */
  endpoint?: string;
}

/**
 * `R2_ENDPOINT_OVERRIDE` points the client at a local S3-compatible server
 * for rehearsals. Only plain-HTTP loopback/Docker hosts are accepted, so the
 * variable can never redirect a real backup (or its credentials) to another
 * service; the backup workflow never sets it.
 */
export function endpointOverride(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!/^http:\/\/(127\.0\.0\.1|localhost|host\.docker\.internal|minio)(:\d{1,5})?$/.test(value)) {
    throw new Error("R2_ENDPOINT_OVERRIDE accepts only a local test endpoint (http://127.0.0.1:<port>, localhost, host.docker.internal or minio).");
  }
  return value;
}

/** Reads `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and the bucket (`R2_BUCKET_NAME` unless overridden). Names what is missing, never a value. */
export function readR2Config(env: NodeJS.ProcessEnv, bucketVar = "R2_BUCKET_NAME"): R2Config {
  const wanted = { accountId: "R2_ACCOUNT_ID", accessKeyId: "R2_ACCESS_KEY_ID", secretAccessKey: "R2_SECRET_ACCESS_KEY", bucket: bucketVar } as const;
  const missing = Object.values(wanted).filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`R2 is not configured: ${missing.join(", ")} must be set.`);
  return {
    accountId: env[wanted.accountId]!,
    accessKeyId: env[wanted.accessKeyId]!,
    secretAccessKey: env[wanted.secretAccessKey]!,
    bucket: env[wanted.bucket]!,
    endpoint: endpointOverride(env.R2_ENDPOINT_OVERRIDE),
  };
}

/** True when every R2 variable is present (for read-only planning without failing). */
export function hasR2Config(env: NodeJS.ProcessEnv, bucketVar = "R2_BUCKET_NAME"): boolean {
  return ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", bucketVar].every((name) => Boolean(env[name]));
}

export function r2Client(config: R2Config): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint ?? `https://${config.accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: config.endpoint !== undefined,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

export async function objectExists(client: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return false;
    throw error;
  }
}

export async function putObject(
  client: S3Client,
  bucket: string,
  key: string,
  body: Uint8Array,
  options: { contentType: string; cacheControl?: string },
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: options.contentType,
      CacheControl: options.cacheControl,
    }),
  );
}

/** The whole object, for read-back verification and restores. */
export async function getObjectBytes(client: S3Client, bucket: string, key: string): Promise<Uint8Array> {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error(`R2 returned no body for ${key}`);
  return result.Body.transformToByteArray();
}

export async function listKeys(client: S3Client, bucket: string, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const item of page.Contents ?? []) if (item.Key) keys.push(item.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

export async function deleteKeys(client: S3Client, bucket: string, keys: readonly string[]): Promise<void> {
  for (const key of keys) await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
