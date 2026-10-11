import { rm } from "node:fs/promises";
import { join } from "node:path";
import { CookieJar } from "tough-cookie";
import { z } from "zod";
import { readOptionalJson, writeJson, type AppPaths } from "../storage.ts";

export const LEETCODE_URL = "https://leetcode.com";
export const DEFAULT_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

export const browserCookieSchema = z.object({
  name: z.string().regex(/^[^\s=;\r\n]+$/),
  value: z.string().regex(/^[^;\r\n]*$/),
  domain: z.string(),
  path: z.string().default("/"),
  expires: z.number().default(-1),
  httpOnly: z.boolean().default(false),
  secure: z.boolean().default(true),
  sameSite: z.enum(["Strict", "Lax", "None"]).default("Lax"),
});
export type BrowserCookie = z.infer<typeof browserCookieSchema>;

const savedSessionSchema = z.object({
  version: z.literal(1),
  jar: z.string(),
  userAgent: z.string(),
  username: z.string().optional(),
  savedAt: z.string(),
});

export function isLeetCodeDomain(domain: string): boolean {
  const host = domain.replace(/^\./, "");
  return host === "leetcode.com" || host.endsWith(".leetcode.com");
}

function cookieHeader(cookie: BrowserCookie): string {
  const attributes = [
    `${cookie.name}=${cookie.value}`,
    `Domain=${cookie.domain}`,
    `Path=${cookie.path}`,
    `SameSite=${cookie.sameSite}`,
    cookie.secure ? "Secure" : "",
    cookie.httpOnly ? "HttpOnly" : "",
    cookie.expires > 0 ? `Expires=${new Date(cookie.expires * 1000).toUTCString()}` : "",
  ];
  return attributes.filter(Boolean).join("; ");
}

export class Session {
  constructor(
    readonly jar = new CookieJar(),
    readonly userAgent = DEFAULT_USER_AGENT,
    private readonly path?: string,
    public username?: string,
    private persistUpdates = true,
  ) {}

  static async load(paths: AppPaths): Promise<Session> {
    const path = join(paths.state, "session.json");
    const data = await readOptionalJson(path);
    if (!data) return new Session(new CookieJar(), DEFAULT_USER_AGENT, path);
    const stored = savedSessionSchema.parse(data);
    return new Session(CookieJar.deserializeSync(stored.jar), stored.userAgent, path, stored.username);
  }

  static fromCookies(cookies: BrowserCookie[], paths: AppPaths, userAgent = DEFAULT_USER_AGENT): Session {
    const jar = new CookieJar();
    const applicable = cookies.filter((cookie) => isLeetCodeDomain(cookie.domain));
    for (const cookie of applicable) jar.setCookieSync(cookieHeader(cookie), `https://${cookie.domain.replace(/^\./, "")}`);
    return new Session(jar, userAgent, join(paths.state, "session.json"), undefined, false);
  }

  get signedIn(): boolean {
    return this.jar.getCookiesSync(LEETCODE_URL).some((cookie) => cookie.key === "LEETCODE_SESSION");
  }

  headers(url: string): Record<string, string> {
    const csrf = this.jar.getCookiesSync(url).find((cookie) => cookie.key === "csrftoken")?.value;
    return {
      "User-Agent": this.userAgent,
      Cookie: this.jar.getCookieStringSync(url),
      ...(csrf ? { "X-CSRFToken": csrf } : {}),
    };
  }

  async update(response: Response, url: string): Promise<void> {
    const cookies = response.headers.getSetCookie();
    for (const cookie of cookies) this.jar.setCookieSync(cookie, url);
    if (cookies.length && this.signedIn && this.persistUpdates) await this.save();
  }

  async save(): Promise<void> {
    if (!this.path) return;
    await writeJson(this.path, {
      version: 1,
      jar: JSON.stringify(this.jar.serializeSync()),
      userAgent: this.userAgent,
      username: this.username,
      savedAt: new Date().toISOString(),
    }, true);
    this.persistUpdates = true;
  }
}

export async function logout(paths: AppPaths): Promise<void> {
  await rm(join(paths.state, "session.json"), { force: true });
  await rm(join(paths.state, "browser"), { recursive: true, force: true });
}
