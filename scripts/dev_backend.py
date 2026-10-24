"""Reload the API without broadcasting Windows CTRL_C_EVENT to the frontend."""
from pathlib import Path
import sys
import uvicorn
from uvicorn._subprocess import get_subprocess
from uvicorn.supervisors.watchfilesreload import WatchFilesReload

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class IsolatedReload(WatchFilesReload):
    def restart(self):
        from backend.services.process_control import terminate_tree
        if self.process.is_alive():
            terminate_tree(self.process.pid)
        self.process.join()
        self.process = get_subprocess(config=self.config, target=self.target, sockets=self.sockets)
        self.process.start()

    def shutdown(self):
        from backend.services.process_control import terminate_tree
        if self.process.is_alive():
            terminate_tree(self.process.pid)
        self.process.join()
        for socket in self.sockets:
            socket.close()


if __name__ == "__main__":
    from backend.services.process_control import watch_parent
    watch_parent()
    config = uvicorn.Config("backend.main:app", host="0.0.0.0", port=8000, reload=True, reload_dirs=[str(ROOT / "backend")])
    server = uvicorn.Server(config)
    IsolatedReload(config, target=server.run, sockets=[config.bind_socket()]).run()
