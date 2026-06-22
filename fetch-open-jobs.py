import argparse
import html
import json
import re
import ssl
import sys
import time
from html.parser import HTMLParser
from pathlib import Path
from time import sleep
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen

PROJECT_ROOT = Path(__file__).resolve().parent
COMPANIES_PATH = PROJECT_ROOT / "companies.js"
JOBS_PATH = PROJECT_ROOT / "jobs.js"
REPORT_PATH = PROJECT_ROOT / "open-jobs-report.json"

DEFAULT_KEYWORDS = [
    "前端", "后端", "Java", "Go", "Python", "产品", "数据", "算法", "测试",
    "运维", "安全", "嵌入式", "硬件", "芯片", "自动驾驶", "电池", "风控", "量化",
]

JOB_HINTS = [
    "招聘", "岗位", "职位", "社招", "校招", "实习", "工程师", "开发", "产品", "运营", "数据",
    "算法", "测试", "设计", "经理", "专员", "管培", "research", "engineer", "developer",
    "designer", "product", "data", "intern", "campus", "job", "career", "position",
]

REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self._current_href = None
        self._text_parts = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "a":
            return
        attrs_dict = dict(attrs)
        href = attrs_dict.get("href")
        if href:
            self._current_href = href
            self._text_parts = []

    def handle_data(self, data):
        if self._current_href:
            self._text_parts.append(data)

    def handle_endtag(self, tag):
        if tag.lower() != "a" or not self._current_href:
            return
        text = normalize_space(" ".join(self._text_parts))
        self.links.append({"href": self._current_href, "text": text})
        self._current_href = None
        self._text_parts = []


def normalize_space(value):
    return re.sub(r"\s+", " ", html.unescape(str(value))).strip()


def load_companies():
    content = COMPANIES_PATH.read_text(encoding="utf-8")
    pattern = re.compile(r'name:\s*"([^"]+)".*?careerUrl:\s*"([^"]+)"')
    return [{"name": match.group(1), "careerUrl": match.group(2)} for match in pattern.finditer(content)]


def fetch_html(url, timeout):
    request = Request(url, headers=REQUEST_HEADERS)
    context = ssl.create_default_context()
    with urlopen(request, timeout=timeout, context=context) as response:
        raw = response.read(1_500_000)
        charset = response.headers.get_content_charset() or "utf-8"
        return raw.decode(charset, errors="replace"), response.geturl()


def text_matches(text, keywords):
    lowered = text.lower()
    return any(keyword.lower() in lowered for keyword in keywords)


def looks_like_job(text, href, keywords, strict_keywords):
    combined = f"{text} {href}"
    if text_matches(combined, keywords):
        return True
    if strict_keywords:
        return False
    lowered = combined.lower()
    return any(hint.lower() in lowered for hint in JOB_HINTS) and len(text) >= 4


def extract_links(company, page_html, final_url, keywords, limit, strict_keywords):
    parser = LinkParser()
    parser.feed(page_html)
    jobs = []
    seen = set()

    for link in parser.links:
        text = normalize_space(link["text"])
        href = link["href"].strip()
        if not href or href.startswith("javascript:") or href.startswith("#"):
            continue
        if not looks_like_job(text, href, keywords, strict_keywords):
            continue

        url = urljoin(final_url, href)
        title = text or infer_title_from_url(url)
        key = (company["name"], title, url)
        if key in seen:
            continue
        seen.add(key)
        jobs.append({
            "company": company["name"],
            "title": title[:120],
            "location": "",
            "url": url,
            "source": "官网公开页面",
        })
        if len(jobs) >= limit:
            break

    return jobs


def fetch_json(url, timeout):
    request = Request(url, headers={**REQUEST_HEADERS, "Accept": "application/json,text/plain,*/*"})
    context = ssl.create_default_context()
    with urlopen(request, timeout=timeout, context=context) as response:
        raw = response.read(2_000_000)
        charset = response.headers.get_content_charset() or "utf-8"
        return json.loads(raw.decode(charset, errors="replace"))


def fetch_tencent_jobs(company, keywords, limit, timeout):
    keyword = " ".join(keywords[:3]).strip()
    query = {
        "timestamp": int(time.time() * 1000),
        "countryId": "",
        "cityId": "",
        "bgIds": "",
        "productId": "",
        "categoryId": "",
        "parentCategoryId": "",
        "attrId": "",
        "keyword": keyword,
        "pageIndex": 1,
        "pageSize": limit,
        "language": "zh-cn",
        "area": "cn",
    }
    url = "https://careers.tencent.com/tencentcareer/api/post/Query?" + urlencode(query)
    payload = fetch_json(url, timeout)
    posts = payload.get("Data", {}).get("Posts", [])
    jobs = []
    for post in posts[:limit]:
      post_url = post.get("PostURL") or f"https://careers.tencent.com/jobdesc.html?postId={post.get('PostId', '')}"
      jobs.append({
          "company": company["name"],
          "title": normalize_space(post.get("RecruitPostName", "岗位详情")),
          "location": normalize_space(post.get("LocationName", "")),
          "url": post_url.replace("http://", "https://"),
          "source": "腾讯招聘公开接口",
          "updatedAt": normalize_space(post.get("LastUpdateTime", "")),
      })
    return jobs


def fetch_dedicated_jobs(company, keywords, limit, timeout):
    if company["name"] in {"腾讯", "腾讯云"}:
        return fetch_tencent_jobs(company, keywords, limit, timeout)
    return None


def infer_title_from_url(url):
    tail = url.rstrip("/").split("/")[-1]
    tail = re.sub(r"[-_]+", " ", tail)
    return normalize_space(tail) or "岗位详情"


def write_jobs(jobs, report):
    payload = "window.OPEN_JOBS = " + json.dumps(jobs, ensure_ascii=False, indent=2) + ";\n"
    JOBS_PATH.write_text(payload, encoding="utf-8")
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="从企业官网公开页面抓取疑似开放岗位，生成 jobs.js。")
    parser.add_argument("keywords", nargs="*", help="岗位关键词，例如：前端 上海 数据分析")
    parser.add_argument("--limit-companies", type=int, default=40, help="最多检测多少家公司，默认 40。")
    parser.add_argument("--jobs-per-company", type=int, default=8, help="每家公司最多保留多少条，默认 8。")
    parser.add_argument("--timeout", type=int, default=10, help="单个官网请求超时秒数，默认 10。")
    parser.add_argument("--delay", type=float, default=0.4, help="每家公司之间的间隔秒数，默认 0.4。")
    args = parser.parse_args()

    strict_keywords = bool(args.keywords)
    keywords = args.keywords or DEFAULT_KEYWORDS
    companies = load_companies()[: max(args.limit_companies, 1)]
    jobs = []
    report = {
        "keywords": keywords,
        "checkedCompanies": len(companies),
        "companies": [],
    }

    for index, company in enumerate(companies, start=1):
        print(f"[{index}/{len(companies)}] {company['name']} {company['careerUrl']}")
        item = {"company": company["name"], "url": company["careerUrl"], "ok": False, "count": 0, "error": ""}
        try:
            dedicated_jobs = fetch_dedicated_jobs(company, keywords, args.jobs_per_company, args.timeout)
            if dedicated_jobs is not None:
                found = dedicated_jobs
                item["finalUrl"] = company["careerUrl"]
                item["source"] = "dedicated"
            else:
                page_html, final_url = fetch_html(company["careerUrl"], args.timeout)
                found = extract_links(company, page_html, final_url, keywords, args.jobs_per_company, strict_keywords)
                item["finalUrl"] = final_url
                item["source"] = "generic-html"
            jobs.extend(found)
            item["ok"] = True
            item["count"] = len(found)
        except (HTTPError, URLError, TimeoutError, ssl.SSLError, UnicodeError, OSError) as error:
            item["error"] = str(error)
        report["companies"].append(item)
        sleep(args.delay)

    report["jobCount"] = len(jobs)
    write_jobs(jobs, report)
    print(f"\nDone. jobs={len(jobs)}")
    print(f"Generated: {JOBS_PATH}")
    print(f"Report: {REPORT_PATH}")
    if len(jobs) == 0:
        print("注意：很多官网是 JS 渲染或有访问限制，纯静态抓取可能拿不到岗位。可以缩小关键词或针对重点企业做专用接口。")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit("Canceled")
