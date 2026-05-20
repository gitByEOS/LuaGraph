import { spawn } from "node:child_process";

type BrowserCommand = {
  readonly command: string;
  readonly args: readonly string[];
};

export async function openUrl(url: string): Promise<void> {
  const browserCommand = resolveBrowserCommand(url);

  await runBrowserCommand(browserCommand);
}

function resolveBrowserCommand(url: string): BrowserCommand {
  if (process.platform === "darwin") {
    return { command: "open", args: [url] };
  }

  if (process.platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", url] };
  }

  return { command: "xdg-open", args: [url] };
}

async function runBrowserCommand(browserCommand: BrowserCommand): Promise<void> {
  await new Promise<void>((resolveOpen, rejectOpen) => {
    const child = spawn(browserCommand.command, browserCommand.args, { stdio: "ignore" });

    child.once("error", rejectOpen);
    child.once("close", (code) => {
      if (code === 0) {
        resolveOpen();
        return;
      }

      rejectOpen(new Error(`打开浏览器失败：${browserCommand.command} exited with ${code}`));
    });
  });
}
