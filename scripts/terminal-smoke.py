"""Check editor integration and terminal cleanup with an isolated workspace."""

import fcntl
import os
from pathlib import Path
import pty
import pyte
import select
import shlex
import signal
import struct
import sys
import tempfile
import termios
import time


def editor(path):
    root = Path(os.environ["LEETCOVE_SMOKE_ROOT"]).resolve()
    file = Path(path).resolve()
    if not file.is_relative_to(root):
        raise RuntimeError("Editor received a path outside the test workspace")
    flags = termios.tcgetattr(sys.stdin.fileno())[3]
    if not flags & termios.ICANON or not flags & termios.ECHO:
        raise RuntimeError("OpenTUI did not restore canonical terminal mode")
    content = file.read_text()
    addition = "\n[3,3]\n6\n" if file.name == "tests.txt" else "\n# Edited through Ctrl+E\n"
    file.write_text(content + addition)
    print("TERMINAL_EDITOR_OK", flush=True)


class Terminal:
    def __init__(self, descriptor):
        self.descriptor = descriptor
        self.output = ""
        self.screen = pyte.Screen(110, 32)
        self.stream = pyte.Stream(self.screen)

    def send(self, data):
        mark = len(self.output)
        os.write(self.descriptor, data)
        return mark

    def pump(self):
        ready, _, _ = select.select([self.descriptor], [], [], 0.1)
        if not ready:
            return
        try:
            data = os.read(self.descriptor, 65536)
        except OSError:
            return
        decoded = data.decode(errors="replace")
        self.output += decoded
        self.stream.feed(decoded)

    def idle(self):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            self.pump()
            if "working…" not in "\n".join(self.screen.display):
                return
        raise RuntimeError("TUI remained busy")

    def wait(self, text, mark=0, timeout=45, ignore_whitespace=False):
        expected = "".join(text.split()) if ignore_whitespace else text
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            readable = "\n".join(self.screen.display)
            visible = "".join(readable.split()) if ignore_whitespace else readable
            if expected in visible or (text == "TERMINAL_EDITOR_OK" and text in self.output[mark:]):
                return
            self.pump()
        raise RuntimeError(f"Terminal did not display {text!r}. Last screen:\n{readable}")


def wait_for_exit(pid, terminal):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        finished, status = os.waitpid(pid, os.WNOHANG)
        if finished:
            return status
        terminal.pump()
    raise RuntimeError("TUI did not quit cleanly")


def stop_process(pid):
    try:
        finished, _ = os.waitpid(pid, os.WNOHANG)
    except ChildProcessError:
        return
    if finished:
        return
    os.kill(pid, signal.SIGTERM)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        finished, _ = os.waitpid(pid, os.WNOHANG)
        if finished:
            return
        time.sleep(0.1)
    os.kill(pid, signal.SIGKILL)
    os.waitpid(pid, 0)


def smoke():
    with tempfile.TemporaryDirectory(prefix="leetcove-terminal-") as workspace:
        run_smoke(workspace)


def run_smoke(workspace):
    script = Path(__file__).resolve()
    environment = {**os.environ, "TERM": "xterm-256color", "LEETCOVE_WORKSPACE": workspace,
                    "XDG_CONFIG_HOME": str(Path(workspace) / "config"),
                    "XDG_STATE_HOME": str(Path(workspace) / "state"),
                    "XDG_CACHE_HOME": str(Path(workspace) / "cache"),
                    "XDG_DATA_HOME": str(Path(workspace) / "data"),
                    "LEETCOVE_SMOKE_ROOT": workspace,
                    "EDITOR": shlex.join([sys.executable, str(script), "--editor"])}
    pid, descriptor = pty.fork()
    if pid == 0:
        os.execvpe("bun", ["bun", str(script.with_name("terminal-fixture.ts"))], environment)
    fcntl.ioctl(descriptor, termios.TIOCSWINSZ, struct.pack("HHHH", 32, 110, 0, 0))
    terminal = Terminal(descriptor)
    exited = False
    try:
        terminal.wait("Ctrl+E opens your solution")
        mark = terminal.send(b"v")
        terminal.wait("class Solution", mark)
        mark = terminal.send(b"\x05")
        terminal.wait("TERMINAL_EDITOR_OK", mark)
        terminal.wait("Edited through Ctrl+E", mark)
        mark = terminal.send(b"t")
        terminal.wait("Custom test inputs", mark)
        mark = terminal.send(b"\x05")
        terminal.wait("TERMINAL_EDITOR_OK", mark)
        terminal.wait(f"Reloaded {workspace}/1-two-sum/tests.txt", mark, ignore_whitespace=True)
        terminal.idle()
        flags = termios.tcgetattr(descriptor)[3]
        if flags & termios.ICANON or flags & termios.ECHO:
            raise RuntimeError("OpenTUI did not restore raw mode after editing")
        solution = Path(workspace) / "1-two-sum" / "solution.python3.py"
        tests = solution.parent / "tests.txt"
        if "Edited through Ctrl+E" not in solution.read_text() or tests.read_text().count("[3,3]") != 2:
            raise RuntimeError("Edited solution/test files were not preserved")
        terminal.send(b"q")
        terminal.wait("Problems", timeout=10)
        terminal.send(b"q")
        status = wait_for_exit(pid, terminal)
        exited = True
        if os.waitstatus_to_exitcode(status) != 0:
            raise RuntimeError("TUI exited unsuccessfully")
        print("Terminal smoke passed: problem view, solution/tests editors, canonical mode, file reload, clean quit.")
    finally:
        if not exited:
            stop_process(pid)
        os.close(descriptor)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--editor":
        editor(sys.argv[2])
    else:
        smoke()


if __name__ == "__main__":
    main()
