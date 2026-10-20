import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';

/** Chromium location: ARCHFLOW_CHROMIUM, or the one preinstalled for Playwright. */
export function chromiumPath(): string | undefined {
  const candidates = [process.env.ARCHFLOW_CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p));
}

export async function launch(): Promise<Browser> {
  const executablePath = chromiumPath();
  return chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' });
}
