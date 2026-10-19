/**
 * Cloudflare R2 through its S3-compatible API — used only by operator
 * scripts (asset upload, backups), never by the app at runtime (plan §5
 * Phase 14 security: R2 credentials are server-only, upload/backup only).
 *
 * Every caller is dry-run unless it passes `{ apply: true }`, and a dry run
 * needs no credentials at all: it prints what it would do.
 */
import { DeleteObjectsCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
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
  };
}

export function r2Client(config: R2Config): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
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
  options: { contentType: string; cacheControl?: string; sha256Base64?: string },
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: options.contentType,
      CacheControl: options.cacheControl,
      ChecksumSHA256: options.sha256Base64,
    }),
  );
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
  for (let start = 0; start < keys.length; start += 1000) {
    const batch = keys.slice(start, start + 1000);
    const result = await client.send(
      new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }),
    );
    if (result.Errors && result.Errors.length > 0) {
      throw new Error(`R2 refused to delete ${result.Errors.length} object(s), first: ${result.Errors[0]?.Key}`);
    }
  }
}
