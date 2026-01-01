#!/usr/bin/env python3
"""
MLX Runner - CLI interface for MLX model operations.
Called by the MCP server as a subprocess.
"""

import argparse
import json
import sys
from pathlib import Path


def cmd_search(args):
    """Search Hugging Face Hub for MLX-compatible models."""
    from huggingface_hub import HfApi

    try:
        api = HfApi()

        # Search in mlx-community org and models with mlx tag
        results = []

        # Search mlx-community organization
        models = api.list_models(
            search=args.query,
            author="mlx-community",
            sort="downloads",
            direction=-1,
            limit=args.limit,
        )

        for model in models:
            results.append({
                "model_id": model.id,
                "downloads": model.downloads or 0,
                "likes": model.likes or 0,
                "tags": model.tags or [],
                "last_modified": model.last_modified.isoformat() if model.last_modified else None,
            })

        # If we didn't find enough, also search for mlx tag
        if len(results) < args.limit:
            mlx_tagged = api.list_models(
                search=args.query,
                tags="mlx",
                sort="downloads",
                direction=-1,
                limit=args.limit - len(results),
            )

            existing_ids = {r["model_id"] for r in results}
            for model in mlx_tagged:
                if model.id not in existing_ids:
                    results.append({
                        "model_id": model.id,
                        "downloads": model.downloads or 0,
                        "likes": model.likes or 0,
                        "tags": model.tags or [],
                        "last_modified": model.last_modified.isoformat() if model.last_modified else None,
                    })

        # Sort by downloads
        results.sort(key=lambda m: m["downloads"], reverse=True)
        results = results[:args.limit]

        print(json.dumps({"results": results, "count": len(results)}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


def cmd_download(args):
    """Download a model from Hugging Face Hub."""
    print(json.dumps({"error": "not implemented"}))
    sys.exit(1)


def cmd_list(args):
    """List locally downloaded models."""
    from huggingface_hub import scan_cache_dir

    try:
        cache_info = scan_cache_dir()
        models = []

        for repo in cache_info.repos:
            # Only include MLX models (from mlx-community or with mlx in name)
            if "mlx" in repo.repo_id.lower() or repo.repo_id.startswith("mlx-community/"):
                # Get the most recent revision
                revisions = sorted(repo.revisions, key=lambda r: r.last_modified, reverse=True)
                if revisions:
                    latest = revisions[0]
                    models.append({
                        "model_id": repo.repo_id,
                        "size_bytes": repo.size_on_disk,
                        "size_human": f"{repo.size_on_disk / (1024**3):.1f} GB",
                        "last_modified": latest.last_modified.isoformat(),
                        "path": str(latest.snapshot_path),
                    })

        # Sort by last modified (most recent first)
        models.sort(key=lambda m: m["last_modified"], reverse=True)

        print(json.dumps({"models": models, "total_size_bytes": sum(m["size_bytes"] for m in models)}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


def cmd_remove(args):
    """Remove a locally downloaded model."""
    print(json.dumps({"error": "not implemented"}))
    sys.exit(1)


def cmd_infer(args):
    """Run inference on a model (streaming output)."""
    print(json.dumps({"error": "not implemented"}))
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="MLX model operations")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # search command
    search_parser = subparsers.add_parser("search", help="Search HF Hub")
    search_parser.add_argument("query", help="Search query")
    search_parser.add_argument("--limit", type=int, default=10)
    search_parser.set_defaults(func=cmd_search)

    # download command
    download_parser = subparsers.add_parser("download", help="Download model")
    download_parser.add_argument("model_id", help="Model ID (e.g., mlx-community/Llama-3.2-3B-4bit)")
    download_parser.add_argument("--quantize", choices=["4bit", "8bit"])
    download_parser.set_defaults(func=cmd_download)

    # list command
    list_parser = subparsers.add_parser("list", help="List local models")
    list_parser.set_defaults(func=cmd_list)

    # remove command
    remove_parser = subparsers.add_parser("remove", help="Remove local model")
    remove_parser.add_argument("model_id", help="Model ID to remove")
    remove_parser.set_defaults(func=cmd_remove)

    # infer command
    infer_parser = subparsers.add_parser("infer", help="Run inference")
    infer_parser.add_argument("model_id", help="Model ID")
    infer_parser.add_argument("--prompt", required=True, help="Input prompt")
    infer_parser.add_argument("--max-tokens", type=int, default=256)
    infer_parser.add_argument("--temperature", type=float, default=0.7)
    infer_parser.set_defaults(func=cmd_infer)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
