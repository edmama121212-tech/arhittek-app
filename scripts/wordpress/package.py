"""Build the installable WordPress plugin from the checked public application."""
import argparse
import json
import subprocess
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
PLUGIN = "arhittek-workspace"
# Binary runtime assets are deliberately explicit. Never walk the repository
# for arbitrary files. The build's manifest owns the list of text resources.
BINARIES = (
    "assets/studio-house.webp",
    "icon-32.png", "icon-152.png", "icon-167.png",
    "icon-180.png", "icon-192.png", "icon-512.png",
)


class DocumentLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        attribute = {"link": "href", "script": "src", "img": "src", "source": "src"}.get(tag)
        reference = attrs.get(attribute)
        if reference:
            parsed = urlsplit(reference)
            if parsed.path and not parsed.scheme and not parsed.netloc:
                self.links.add(parsed.path.removeprefix("./"))


def verify_links(outputs, files):
    for document in (name for name in outputs if name.endswith(".html")):
        parser = DocumentLinks()
        parser.feed((ROOT / document).read_text())
        for reference in parser.links:
            if "app/" + reference not in files:
                raise ValueError(f"Unpackaged reference in {document}: {reference}")


def package(destination):
    subprocess.run(["node", "scripts/build.cjs", "--check"], cwd=ROOT, check=True)
    outputs = json.loads((ROOT / "src/manifest.json").read_text())["outputs"]
    files = {f"app/{name}": ROOT / name for name in (*outputs, *BINARIES)}
    files["arhittek-workspace.php"] = Path(__file__).with_name("arhittek-workspace.php")
    verify_links(outputs, files)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w") as archive:
        for name, source in sorted(files.items()):
            entry = zipfile.ZipInfo(f"{PLUGIN}/{name}", date_time=(2026, 1, 1, 0, 0, 0))
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, source.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    with zipfile.ZipFile(destination) as archive:
        assert archive.testzip() is None
        assert set(archive.namelist()) == {f"{PLUGIN}/{name}" for name in files}
        for name, source in files.items():
            assert archive.read(f"{PLUGIN}/{name}") == source.read_bytes(), name
    print(f"{len(files) - 1} public assets plus WordPress plugin: {destination}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    package(parser.parse_args().destination)
