#!/usr/bin/env python3
"""
MLX Runner - CLI interface for MLX model operations.
Called by the MCP server as a subprocess.
"""

import argparse
import json
import sys
from pathlib import Path


def _format_timestamp(ts) -> str:
    """Convert timestamp to ISO format string, handling both datetime and float."""
    from datetime import datetime
    if isinstance(ts, (int, float)):
        return datetime.fromtimestamp(ts).isoformat()
    elif hasattr(ts, 'isoformat'):
        return ts.isoformat()
    else:
        return str(ts)


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
                "last_modified": _format_timestamp(model.last_modified) if model.last_modified else None,
            })

        # If we didn't find enough, also search for mlx tag
        if len(results) < args.limit:
            mlx_tagged = api.list_models(
                search=args.query,
                filter="mlx",
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
                        "last_modified": _format_timestamp(model.last_modified) if model.last_modified else None,
                    })

        # Sort by downloads
        results.sort(key=lambda m: m["downloads"], reverse=True)
        results = results[:args.limit]

        print(json.dumps({"results": results, "count": len(results)}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


class JsonProgressBar:
    """Custom tqdm-like class that emits JSON progress updates."""

    def __init__(self, *args, total=None, desc=None, unit=None, **kwargs):
        self.total = total or 0
        self.desc = desc or ""
        self.n = 0
        self._last_percent = -1

    def update(self, n=1):
        self.n += n
        if self.total > 0:
            percent = int(100 * self.n / self.total)
            # Only emit update every 5% to avoid flooding
            if percent >= self._last_percent + 5 or percent == 100:
                self._last_percent = percent
                print(json.dumps({
                    "type": "progress",
                    "file": self.desc,
                    "downloaded": self.n,
                    "total": self.total,
                    "percent": percent,
                }), flush=True)

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


def cmd_download(args):
    """Download a model from Hugging Face Hub."""
    from huggingface_hub import snapshot_download, HfApi
    from huggingface_hub.utils import GatedRepoError, RepositoryNotFoundError

    try:
        api = HfApi()

        # Check if model exists and get size info
        try:
            model = api.model_info(args.model_id, files_metadata=True)
        except RepositoryNotFoundError:
            print(json.dumps({"error": f"Model not found: {args.model_id}"}))
            sys.exit(1)
        except GatedRepoError:
            print(json.dumps({
                "error": f"Model {args.model_id} is gated. Run 'huggingface-cli login' first.",
                "gated": True
            }))
            sys.exit(1)

        # Calculate total size from siblings
        total_size = 0
        file_count = 0
        if model.siblings:
            for sibling in model.siblings:
                if sibling.size is not None:
                    total_size += sibling.size
                    file_count += 1

        # Start download with progress info
        print(json.dumps({
            "type": "status",
            "status": "downloading",
            "model_id": args.model_id,
            "total_size": total_size,
            "total_size_human": f"{total_size / (1024**3):.1f} GB" if total_size else "unknown",
            "file_count": file_count,
        }), flush=True)

        path = snapshot_download(
            repo_id=args.model_id,
            local_dir_use_symlinks=False,
            tqdm_class=JsonProgressBar,
        )

        # Get actual size on disk
        from pathlib import Path
        disk_size = sum(f.stat().st_size for f in Path(path).rglob("*") if f.is_file())

        print(json.dumps({
            "type": "complete",
            "status": "complete",
            "model_id": args.model_id,
            "path": path,
            "size_bytes": disk_size,
            "size_human": f"{disk_size / (1024**3):.1f} GB",
        }))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
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
                revisions = sorted(repo.revisions, key=lambda r: r.last_modified if isinstance(r.last_modified, (int, float)) else r.last_modified.timestamp(), reverse=True)
                if revisions:
                    latest = revisions[0]
                    models.append({
                        "model_id": repo.repo_id,
                        "size_bytes": repo.size_on_disk,
                        "size_human": f"{repo.size_on_disk / (1024**3):.1f} GB",
                        "last_modified": _format_timestamp(latest.last_modified),
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
    from huggingface_hub import scan_cache_dir

    try:
        cache_info = scan_cache_dir()

        # Find the model in cache
        target_repo = None
        for repo in cache_info.repos:
            if repo.repo_id == args.model_id:
                target_repo = repo
                break

        if not target_repo:
            print(json.dumps({"error": f"Model not found in cache: {args.model_id}"}))
            sys.exit(1)

        # Get size before deletion
        size_bytes = target_repo.size_on_disk

        # Delete all revisions
        delete_strategy = cache_info.delete_revisions(
            *[rev.commit_hash for rev in target_repo.revisions]
        )

        # Execute deletion
        delete_strategy.execute()

        print(json.dumps({
            "status": "removed",
            "model_id": args.model_id,
            "freed_bytes": size_bytes,
            "freed_human": f"{size_bytes / (1024**3):.1f} GB",
        }))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


def cmd_infer(args):
    """Run inference on a model (streaming output)."""
    try:
        # Check if model exists locally first (before importing MLX)
        from huggingface_hub import scan_cache_dir
        cache_info = scan_cache_dir()

        model_path = None
        for repo in cache_info.repos:
            if repo.repo_id == args.model_id:
                revisions = sorted(repo.revisions, key=lambda r: r.last_modified, reverse=True)
                if revisions:
                    model_path = str(revisions[0].snapshot_path)
                break

        if not model_path:
            print(json.dumps({"error": f"Model not found locally: {args.model_id}. Run download first."}))
            sys.exit(1)

        # Import MLX only after confirming model exists
        from mlx_lm import load, stream_generate
        from mlx_lm.sample_utils import make_sampler

        # Load model and tokenizer
        print(json.dumps({"type": "status", "message": "Loading model..."}), flush=True)
        model, tokenizer = load(model_path)

        # Format prompt for chat models
        if hasattr(tokenizer, "apply_chat_template"):
            messages = [{"role": "user", "content": args.prompt}]
            prompt = tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
        else:
            prompt = args.prompt

        # Create sampler with temperature
        sampler = make_sampler(temp=args.temperature)

        # Stream tokens
        print(json.dumps({"type": "status", "message": "Generating..."}), flush=True)

        tokens_generated = 0
        import time
        start_time = time.time()

        for response in stream_generate(
            model,
            tokenizer,
            prompt=prompt,
            max_tokens=args.max_tokens,
            sampler=sampler,
        ):
            tokens_generated += 1
            # response is a GenerationResponse with .text attribute
            token_text = response.text if hasattr(response, 'text') else str(response)
            print(json.dumps({"type": "token", "content": token_text}), flush=True)

        elapsed = time.time() - start_time
        tokens_per_sec = tokens_generated / elapsed if elapsed > 0 else 0

        print(json.dumps({
            "type": "done",
            "tokens_generated": tokens_generated,
            "tokens_per_sec": round(tokens_per_sec, 1),
            "elapsed_sec": round(elapsed, 2),
        }), flush=True)

    except ImportError as e:
        print(json.dumps({"error": f"MLX not installed: {e}. Run: pip install mlx mlx-lm"}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


def cmd_info(args):
    """Get detailed information about a model from HF Hub."""
    from huggingface_hub import HfApi, hf_hub_download
    from huggingface_hub.utils import RepositoryNotFoundError, EntryNotFoundError

    try:
        api = HfApi()

        # Get model info from Hub
        try:
            model = api.model_info(args.model_id)
        except RepositoryNotFoundError:
            print(json.dumps({"error": f"Model not found: {args.model_id}"}))
            sys.exit(1)

        # Basic info from model card
        info = {
            "model_id": model.id,
            "downloads": model.downloads or 0,
            "likes": model.likes or 0,
            "tags": model.tags or [],
            "last_modified": _format_timestamp(model.last_modified) if model.last_modified else None,
            "pipeline_tag": model.pipeline_tag,
            "library_name": model.library_name,
        }

        # Try to get config.json for model details
        try:
            config_path = hf_hub_download(
                repo_id=args.model_id,
                filename="config.json",
                local_files_only=False,
            )
            import json as json_lib
            with open(config_path) as f:
                config = json_lib.load(f)

            # Extract common config fields
            if "max_position_embeddings" in config:
                info["context_length"] = config["max_position_embeddings"]
            elif "max_seq_len" in config:
                info["context_length"] = config["max_seq_len"]
            elif "n_positions" in config:
                info["context_length"] = config["n_positions"]

            if "hidden_size" in config:
                info["hidden_size"] = config["hidden_size"]

            if "num_hidden_layers" in config:
                info["num_layers"] = config["num_hidden_layers"]

            if "num_attention_heads" in config:
                info["num_heads"] = config["num_attention_heads"]

            # Try to estimate parameter count from architecture
            if "hidden_size" in config and "num_hidden_layers" in config:
                h = config["hidden_size"]
                l = config["num_hidden_layers"]
                # Rough estimate: ~12*h^2*l for transformer
                estimated_params = 12 * h * h * l
                info["estimated_params"] = estimated_params
                if estimated_params >= 1e9:
                    info["params_human"] = f"{estimated_params / 1e9:.1f}B"
                elif estimated_params >= 1e6:
                    info["params_human"] = f"{estimated_params / 1e6:.0f}M"

            # Check for quantization info
            if "quantization_config" in config:
                qconfig = config["quantization_config"]
                info["quantization"] = qconfig.get("quant_method", "quantized")
                if "bits" in qconfig:
                    info["quantization_bits"] = qconfig["bits"]

        except (EntryNotFoundError, Exception):
            # No config.json or couldn't parse - continue with basic info
            pass

        # Check if model is downloaded locally
        from huggingface_hub import scan_cache_dir
        cache_info = scan_cache_dir()
        for repo in cache_info.repos:
            if repo.repo_id == args.model_id:
                info["is_local"] = True
                info["local_size_bytes"] = repo.size_on_disk
                info["local_size_human"] = f"{repo.size_on_disk / (1024**3):.1f} GB"
                break
        else:
            info["is_local"] = False

        print(json.dumps(info))

    except Exception as e:
        print(json.dumps({"error": str(e)}))
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

    # info command
    info_parser = subparsers.add_parser("info", help="Get model info")
    info_parser.add_argument("model_id", help="Model ID (e.g., mlx-community/Llama-3.2-3B-4bit)")
    info_parser.set_defaults(func=cmd_info)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
