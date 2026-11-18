"""采集人教社公开教材目录页的来源指纹；不复制教材正文或课后题。"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "textbook-source-snapshot.json"
SOURCES = {
    "chinese": "https://www.pep.com.cn/products/zhytu/gjshnj/csxp/tbzc/202306/t20230628_1984166.shtml",
    "math": "https://www.pep.com.cn/xw/zt/hd/12/xjcjs/xx/202409/t20240920_1995566.html",
    "english": "https://www.pep.com.cn/zslth/yyptzy/xypep/4s/",
}


class Headings(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tag: str | None = None
        self.values: list[str] = []
        self.text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"h1", "h2", "h3", "h4", "h5", "title"}:
            self.tag = tag

    def handle_endtag(self, tag: str) -> None:
        if tag == self.tag:
            self.tag = None

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.text.append(data.strip())
        if self.tag and data.strip():
            self.values.append(data.strip())


def main() -> None:
    rows = []
    for subject, url in SOURCES.items():
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname not in {"www.pep.com.cn", "download.pep.com.cn"}:
            raise ValueError("Unexpected textbook host")
        request = Request(url, headers={"User-Agent": "XiaoheCurriculumResearch/1.0 (source metadata only)"})
        try:
            with urlopen(request, timeout=20) as response:
                if urlparse(response.url).hostname not in {"www.pep.com.cn", "download.pep.com.cn"}:
                    raise ValueError("Unexpected redirect host")
                data = response.read(2_000_001)
            if len(data) > 2_000_000:
                raise ValueError("Textbook page exceeds 2 MB")
            headings = Headings()
            headings.feed(data.decode("utf-8", errors="replace"))
            units = list(dict.fromkeys(value for value in [*headings.values, *headings.text] if re.match(r"^(?:Unit\s*[1-6]\b|第[一二三四五六七八]单元)", value)))
            rows.append({"subject": subject, "url": url, "pageSha256": hashlib.sha256(data).hexdigest(),
                         "fetchedAt": datetime.now(timezone.utc).isoformat(), "visibleUnitHeadings": units,
                         "note": "仅来源校验；目录与课后题须对照实际纸质教材复核"})
            print(f"collected {subject}: {len(units)} visible unit headings")
        except Exception as error:
            rows.append({"subject": subject, "url": url, "error": str(error), "fetchedAt": datetime.now(timezone.utc).isoformat()})
            print(f"unavailable {subject}: {error}")
    OUTPUT.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"saved {OUTPUT}")


if __name__ == "__main__":
    main()
