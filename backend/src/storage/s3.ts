import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";
export class S3Storage {
  private client = new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    credentials: {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
    },
  });
  async put(key: string, bytes: Buffer, mime: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: key,
        Body: bytes,
        ContentType: mime,
      }),
    );
  }
  async head(key: string) {
    const object = await this.client.send(
      new HeadObjectCommand({ Bucket: config.s3.bucket, Key: key }),
    );
    return { size: object.ContentLength };
  }
  async get(key: string, range?: { start: number; end: number }) {
    const total = (await this.head(key)).size;
    const object = await this.client.send(
      new GetObjectCommand({
        Bucket: config.s3.bucket,
        Key: key,
        Range: range ? `bytes=${range.start}-${range.end}` : undefined,
      }),
    );
    return { body: object.Body as any, size: object.ContentLength, total };
  }
  async delete(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key }),
    );
  }
  async readUrl(key: string, filename: string, attachment: boolean) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: config.s3.bucket,
        Key: key,
        ResponseContentType: "application/pdf",
        ResponseContentDisposition: `${attachment ? "attachment" : "inline"}; filename="${filename}"`,
      }),
      { expiresIn: 120 },
    );
  }
}
