"""Lazy compatibility exports; importing a utility must not initialize the video engine."""
from importlib import import_module

_EXPORTS = {'KNOWN_FLASH_MODELS': 'backend.services.ai_service', 'get_flash_models_for_key': 'backend.services.ai_service', 'list_available_gemini_models': 'backend.services.ai_service', 'parse_gemini_model_sort_key': 'backend.services.ai_service', 'raw_clip_download_jobs': 'backend.services.download_service', 'raw_download_jobs': 'backend.services.download_service', 'run_raw_clip_download_job': 'backend.services.download_service', 'run_raw_download_job': 'backend.services.download_service', 'BATCH_REQUESTS': 'backend.services.render_service', 'RENDER_BATCHES': 'backend.services.render_service', 'process_batch_rendering': 'backend.services.render_service', 'process_batch_retry': 'backend.services.render_service', 'render_single_batch_clip': 'backend.services.render_service', 'update_batch_summary_and_zip': 'backend.services.render_service', 'auto_cleanup_expired_files': 'backend.services.system_service', 'clear_temp_files': 'backend.services.system_service', 'get_current_git_info': 'backend.services.system_service', 'get_dir_size_and_count': 'backend.services.system_service', 'get_temp_storage_summary': 'backend.services.system_service', 'run_git_command': 'backend.services.system_service', 'trigger_detached_restart': 'backend.services.system_service', 'check_single_supadata_key': 'backend.services.youtube_service', 'download_youtube_audio_file': 'backend.services.youtube_service', 'fetch_transcript': 'backend.services.youtube_service', 'fetch_transcript_cli': 'backend.services.youtube_service', 'fetch_transcript_supadata': 'backend.services.youtube_service', 'fetch_transcript_ytdlp': 'backend.services.youtube_service', 'fetch_video_metadata': 'backend.services.youtube_service', 'get_supadata_keys': 'backend.services.youtube_service', 'get_supadata_usage_data': 'backend.services.youtube_service', 'get_youtube_oembed_title': 'backend.services.youtube_service', 'normalize_transcript': 'backend.services.youtube_service'}
__all__ = list(_EXPORTS)


def __getattr__(name):
    if name not in _EXPORTS:
        raise AttributeError(name)
    value = getattr(import_module(_EXPORTS[name]), name)
    globals()[name] = value
    return value
