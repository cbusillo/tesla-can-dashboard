import argparse
import json
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote, urlsplit


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: urllib.request.Request, fp: object, code: int, msg: str, headers: object, newurl: str) -> None:
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Approve a verified dashboard browser without exporting its private access code")
    parser.add_argument("--url", required=True, help="Dashboard base URL; HTTPS or local loopback only")
    parser.add_argument("--origin", required=True, help="Configured dashboard HTTPS origin")
    parser.add_argument("--token-file", required=True, type=Path)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--list", action="store_true", help="List pending public approval numbers")
    action.add_argument(
        "--approve", help="Exact requestId from --list, after its displayed number is confirmed by the browser's owner"
    )
    args = parser.parse_args()
    target = urlsplit(args.url)
    if (
        target.username
        or target.password
        or target.query
        or target.fragment
        or not (target.scheme == "https" or (target.scheme == "http" and target.hostname in {"127.0.0.1", "localhost", "::1"}))
    ):
        parser.error("Use HTTPS or a local loopback URL without credentials or query parameters")
    if args.approve is not None and not args.approve.strip():
        parser.error("Use an exact requestId from --list")
    path = "/api/vehicle-controls/browser-requests"
    if args.approve:
        path += f"/{quote(args.approve, safe='')}/approve"
    try:
        token = args.token_file.read_text().strip()
    except OSError:
        raise SystemExit("The private access-code file is unreadable") from None
    request = urllib.request.Request(
        args.url.rstrip("/") + path,
        data=b"{}" if args.approve else None,
        headers={"Authorization": f"Bearer {token}", "Origin": args.origin, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=5) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise SystemExit(f"Browser request failed with HTTP {error.code}; nothing was retried") from None
    except (OSError, ValueError):
        raise SystemExit("Browser request could not be verified; nothing was retried") from None
    print(json.dumps(result))


if __name__ == "__main__":
    main()
