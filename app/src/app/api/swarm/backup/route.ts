import { NextResponse } from "next/server";

interface SwarmBackupRequest {
  filename?: unknown;
  backup?: unknown;
}

function beeBaseUrl(): string | null {
  const raw = process.env.BEE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isBackupObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readSwarmReference(request: Request): string | null {
  const reference = new URL(request.url).searchParams.get("reference")?.trim();
  if (!reference) return null;
  return reference.replace(/^bzz:\/\//, "").replace(/^\/+/, "");
}

export async function GET(request: Request) {
  const baseUrl = beeBaseUrl();
  if (!baseUrl) {
    return errorResponse("Swarm restore is not configured. Set BEE_URL.", 503);
  }

  const reference = readSwarmReference(request);
  if (!reference) {
    return errorResponse("reference is required.", 400);
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/bzz/${encodeURIComponent(reference)}`);
  } catch (e) {
    return errorResponse(`Bee download request failed: ${(e as Error).message}`, 502);
  }

  const text = await response.text();
  if (!response.ok) {
    const detail = text.trim() ? ` ${text.trim()}` : "";
    return errorResponse(
      `Bee download failed with HTTP ${response.status}.${detail}`,
      502,
    );
  }

  let backup: unknown;
  try {
    backup = JSON.parse(text);
  } catch {
    return errorResponse("Swarm reference did not resolve to a JSON backup.", 502);
  }

  if (!isBackupObject(backup)) {
    return errorResponse("Swarm reference did not resolve to a backup object.", 502);
  }

  return NextResponse.json({ backup });
}

export async function POST(request: Request) {
  const baseUrl = beeBaseUrl();
  const postageBatchId = process.env.BEE_POSTAGE_BATCH_ID?.trim();

  if (!baseUrl || !postageBatchId) {
    return errorResponse(
      "Swarm upload is not configured. Set BEE_URL and BEE_POSTAGE_BATCH_ID.",
      503,
    );
  }

  let body: SwarmBackupRequest;
  try {
    body = (await request.json()) as SwarmBackupRequest;
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  if (typeof body.filename !== "string" || body.filename.trim() === "") {
    return errorResponse("filename is required.", 400);
  }
  if (!isBackupObject(body.backup)) {
    return errorResponse("backup object is required.", 400);
  }

  const filename = body.filename.trim();
  const payload = JSON.stringify(body.backup, null, 2);
  const params = new URLSearchParams({ name: filename });

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/bzz?${params.toString()}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Swarm-Postage-Batch-Id": postageBatchId,
      },
      body: payload,
    });
  } catch (e) {
    return errorResponse(`Bee upload request failed: ${(e as Error).message}`, 502);
  }

  const text = await response.text();
  if (!response.ok) {
    const detail = text.trim() ? ` ${text.trim()}` : "";
    return errorResponse(
      `Bee upload failed with HTTP ${response.status}.${detail}`,
      502,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return errorResponse("Bee upload succeeded but returned invalid JSON.", 502);
  }

  const reference =
    parsed && typeof parsed === "object" && "reference" in parsed
      ? (parsed as { reference?: unknown }).reference
      : undefined;
  if (typeof reference !== "string" || reference.length === 0) {
    return errorResponse("Bee upload response did not include a reference.", 502);
  }

  return NextResponse.json({ reference });
}
