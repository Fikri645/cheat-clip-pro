"""Own and stop the complete process tree of a single media job."""
import os
import threading
import psutil


def terminate_tree(pid):
    try:
        root = psutil.Process(pid)
        children = root.children(recursive=True)
        # Stop the root first so it cannot start another encoder during teardown.
        if pid != os.getpid():
            root.suspend()
        for child in children:
            try:
                child.kill()
            except psutil.NoSuchProcess:
                pass
        if pid == os.getpid():
            os._exit(1)
        root.kill()
        psutil.wait_procs(children + [root], timeout=5)
    except psutil.NoSuchProcess:
        pass


def watch_parent():
    parent = psutil.Process(os.getppid())
    def watch():
        while True:
            if not parent.is_running() or parent.status() == psutil.STATUS_ZOMBIE:
                terminate_tree(os.getpid())
                return
            threading.Event().wait(.25)
    threading.Thread(target=watch, daemon=True).start()
