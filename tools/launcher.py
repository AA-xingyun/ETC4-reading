"""CET-4 AI 阅读生成 启动器。

双击后：找到一个空闲端口 → 启动本地 Node 服务（dist-server） → 等它就绪 → 用 Edge 的
--app 模式开一个无地址栏窗口。窗口关闭后自动停掉服务。

参数：
  --selftest   只启动服务、检查 /api/providers，然后退出（给打包后自检用）
  --no-window  只启动服务（不打开浏览器），打印地址
"""
from __future__ import annotations

import ctypes
import json
import os
import random
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

IS_FROZEN = bool(getattr(sys, "frozen", False))


def app_root() -> Path:
    """exe 可能放在应用根目录，也可能放在 dist-launcher；两处都要能找到 dist-server。"""
    if IS_FROZEN:
        base = Path(sys.executable).resolve().parent
        for cand in (base, base.parent):
            if (cand / "dist-server" / "server" / "index.js").exists():
                return cand
        return base
    return Path(__file__).resolve().parent.parent


ROOT = app_root()
DATA = ROOT / "data"
LOG = DATA / "app.log"


def message(text: str) -> None:
    if os.name == "nt":
        ctypes.windll.user32.MessageBoxW(None, text, "CET-4 AI 阅读生成", 0x10)
    else:
        print(text, file=sys.stderr)


def pick_port(preferred: int = 8799) -> int:
    """优先用固定端口，保证 localStorage（词库）的 origin 稳定；被占用时顺延。"""
    for port in range(preferred, preferred + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def session_secret() -> str:
    """会话密钥持久化，重启后前端旧 token 仍然有效，不必重新登录。"""
    path = DATA / "session.key"
    try:
        if path.exists():
            value = path.read_text(encoding="utf-8").strip()
            if len(value) >= 32:
                return value
    except Exception:
        pass
    value = os.urandom(32).hex()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")
    return value


def node_exe() -> str | None:
    bundled = ROOT / "runtime" / "node.exe"
    if bundled.exists():
        return str(bundled)
    found = shutil.which("node")
    return found


def browser_exe() -> str | None:
    candidates = [
        Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe",
        Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Microsoft/Edge/Application/msedge.exe",
        Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Google/Chrome/Application/chrome.exe",
    ]
    for path in candidates:
        if path.exists():
            return str(path)
    return None


def wait_ready(url: str, timeout: float = 60.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url + "/api/providers", timeout=2) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.4)
    return False


def main() -> int:
    selftest = "--selftest" in sys.argv
    no_window = "--no-window" in sys.argv

    server = ROOT / "dist-server" / "server" / "index.js"
    web = ROOT / "dist" / "index.html"
    missing = [str(p) for p in (server, web) if not p.exists()]
    if missing:
        message("缺少构建产物：\n" + "\n".join(missing) + "\n\n请先运行 npm run build:all")
        return 2

    node = node_exe()
    if not node:
        message("找不到 Node.js。\n把 node.exe 放到 runtime\\node.exe，或安装 Node 20+。")
        return 2

    DATA.mkdir(parents=True, exist_ok=True)
    port = pick_port()
    env = dict(os.environ)
    env.update(
        {
            "PORT": str(port),
            "CACHE_DRIVER": env.get("CACHE_DRIVER", "sqlite"),
            "CACHE_DB_PATH": str(DATA / "cache.db"),
            "PROVIDERS_DB_PATH": str(DATA / "providers.json"),
            "SESSION_SECRET": env.get("SESSION_SECRET") or session_secret(),
            "MIN_INTERVAL_MS": env.get("MIN_INTERVAL_MS", "0"),
            "NODE_ENV": "production",
        }
    )

    log = open(LOG, "a", encoding="utf-8", errors="replace")
    log.write(f"\n=== {time.strftime('%Y-%m-%d %H:%M:%S')} port={port} ===\n")
    log.flush()

    creation = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    proc = subprocess.Popen(
        [node, str(server)],
        cwd=str(ROOT),
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
        creationflags=creation,
    )

    url = f"http://127.0.0.1:{port}"
    try:
        if not wait_ready(url):
            message(f"服务启动失败，日志：{LOG}")
            return 1
        if selftest:
            with urllib.request.urlopen(url + "/api/providers", timeout=5) as resp:
                body = json.loads(resp.read().decode("utf-8"))
            print("selftest ok:", len(body.get("providers", [])), "provider(s),", url)
            return 0
        if no_window:
            print(url, flush=True)
            proc.wait()
            return 0

        exe = browser_exe()
        profile = DATA / "browser"
        if exe:
            browser = subprocess.Popen(
                [
                    exe,
                    f"--app={url}/",
                    f"--user-data-dir={profile}",
                    "--window-size=1360,900",
                    "--no-first-run",
                    "--disable-features=Translate",
                ]
            )
            browser.wait()
        else:
            import webbrowser

            webbrowser.open(url)
            print(url, flush=True)
            proc.wait()
        return 0
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                proc.kill()
        log.close()


if __name__ == "__main__":
    sys.exit(main())
