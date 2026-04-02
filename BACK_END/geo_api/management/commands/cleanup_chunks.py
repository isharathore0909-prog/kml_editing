import os
import shutil
import time
from django.core.management.base import BaseCommand
from django.conf import settings

class Command(BaseCommand):
    help = 'Deletes old chunk directories from media/chunks/'

    def add_arguments(self, parser):
        parser.add_argument(
            '--days',
            type=int,
            help='Override the retention period in days (default from settings)',
        )
        parser.add_argument(
            '--force',
            action='store_true',
            help='Delete all chunks regardless of age',
        )

    def handle(self, *args, **options):
        days = options['days'] or getattr(settings, 'CHUNK_STORAGE_RETENTION_DAYS', 1)
        force = options['force']
        
        seconds_threshold = days * 24 * 3600
        now = time.time()
        
        chunks_root = os.path.join(settings.BASE_DIR, 'media', 'chunks')
        if not os.path.exists(chunks_root):
            self.stdout.write(self.style.WARNING(f"Chunks directory not found at {chunks_root}"))
            return

        deleted_count = 0
        self.stdout.write(f"Scanning {chunks_root} (Retention: {days} days)...")

        for session_id in os.listdir(chunks_root):
            if session_id == 'default' and not force:
                continue
                
            session_dir = os.path.join(chunks_root, session_id)
            if not os.path.isdir(session_dir):
                continue
                
            mtime = os.path.getmtime(session_dir)
            meta_path = os.path.join(session_dir, 'metadata.json')
            if os.path.exists(meta_path):
                mtime = os.path.getmtime(meta_path)

            age_seconds = now - mtime
            if force or age_seconds > seconds_threshold:
                age_hours = int(age_seconds / 3600)
                self.stdout.write(f"Deleting expired session: {session_id} (Age: {age_hours}h)")
                shutil.rmtree(session_dir, ignore_errors=True)
                deleted_count += 1

        if deleted_count > 0:
            self.stdout.write(self.style.SUCCESS(f"Successfully deleted {deleted_count} session directories."))
        else:
            self.stdout.write("No expired sessions found.")
