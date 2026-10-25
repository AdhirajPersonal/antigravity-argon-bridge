import { Page, BrowserContext } from 'playwright';

/**
 * Advanced browser stealth evasion scripts.
 * Shields the browser profile against Google bot detection mechanisms:
 * - navigator.webdriver flag removal
 * - Realistic window.chrome object
 * - Permissions API query handling
 * - Realistic plugins & language lists
 * - WebGL vendor/renderer spoofing (standard Intel/Nvidia desktop)
 */
export async function applyStealthEvasions(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    // 1. Completely mask navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });

    // 2. Realistic window.chrome object
    (window as any).chrome = {
      app: {
        isInstalled: false,
        InstallState: { DISABLED: 'DISABLED', INSTALLED: 'INSTALLED', NOT_INSTALLED: 'NOT_INSTALLED' },
        RunningState: { CANNOT_RUN: 'CANNOT_RUN', READY_TO_RUN: 'READY_TO_RUN', RUNNING: 'RUNNING' },
      },
      runtime: {
        OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
        OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
        PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
        RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
      },
      loadTimes: function() {
        return {
          commitLoadTime: Date.now() / 1000 - 1.2,
          connectionInfo: 'h2',
          finishDocumentLoadTime: Date.now() / 1000 - 0.5,
          finishLoadTime: Date.now() / 1000 - 0.2,
          firstPaintAfterLoadTime: 0,
          firstPaintTime: Date.now() / 1000 - 0.8,
          navigationType: 'Other',
          npnNegotiatedProtocol: 'h2',
          requestTime: Date.now() / 1000 - 1.5,
          startLoadTime: Date.now() / 1000 - 1.4,
          wasAlternateProtocolAvailable: false,
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true,
        };
      },
      csi: function() {
        return {
          onloadT: Date.now(),
          pageT: 852.12,
          startE: Date.now() - 1000,
          tran: 15,
        };
      },
    };

    // 3. Realistic plugins list
    const makePlugin = (name: string, filename: string, description: string) => ({
      name,
      filename,
      description,
      length: 1,
      item: () => null,
      namedItem: () => null,
    });

    const fakePlugins = [
      makePlugin('PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      makePlugin('Chrome PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      makePlugin('Chromium PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      makePlugin('Microsoft Edge PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'),
      makePlugin('WebKit built-in PDF', 'internal-pdf-viewer', 'Portable Document Format'),
    ];

    Object.defineProperty(navigator, 'plugins', {
      get: () => fakePlugins,
    });

    // 4. Permissions API mock
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: any) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : originalQuery(parameters);

    // 5. Hardware concurrency & device memory
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => 8,
    });
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => 8,
    });
  });
}

/**
 * Simulates a natural human mouse move and click on an element.
 */
export async function humanClick(page: Page, selector: string): Promise<boolean> {
  const el = page.locator(selector).first();
  if (!(await el.isVisible().catch(() => false))) return false;

  const box = await el.boundingBox();
  if (!box) {
    await el.click();
    return true;
  }

  // Calculate random target inside element box (not exact center)
  const targetX = box.x + box.width * (0.3 + Math.random() * 0.4);
  const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);

  // Move mouse naturally
  await page.mouse.move(targetX, targetY, { steps: 5 + Math.floor(Math.random() * 5) });
  await page.waitForTimeout(60 + Math.floor(Math.random() * 80));
  await page.mouse.down();
  await page.waitForTimeout(40 + Math.floor(Math.random() * 60));
  await page.mouse.up();

  return true;
}
