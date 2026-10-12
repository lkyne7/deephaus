"""Create an exact-size ZIP64 Anki transport fixture without allocating its padding on disk.

The collection is real; the unreferenced stored member is synthetic zero padding.
This tests archive/upload size, not a 10 GiB SQLite collection or media workload.
"""
import os
import sys
import zipfile
import zlib

source, destination, size_text = sys.argv[1:]
target = int(size_text)


def write_archive(padding_size, crc):
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(destination, "w", allowZip64=True) as archive:
        for entry in original.infolist():
            archive.writestr(entry.filename, original.read(entry), compress_type=zipfile.ZIP_STORED)
        padding = zipfile.ZipInfo("upload-test-padding.bin")
        padding.file_size = padding_size
        padding.compress_size = padding_size
        padding.CRC = crc
        padding.header_offset = archive.fp.tell()
        padding.extract_version = 45
        padding.create_version = 45
        archive.fp.write(padding.FileHeader(zip64=True))
        archive.fp.seek(padding_size, os.SEEK_CUR)
        archive.filelist.append(padding)
        archive.NameToInfo[padding.filename] = padding
        archive.start_dir = archive.fp.tell()
        archive._didModify = True


write_archive(target, 0)
padding_size = target - (os.path.getsize(destination) - target)
crc = 0
remaining = padding_size
zeros = bytes(8 * 1024 * 1024)
while remaining:
    chunk = zeros if remaining >= len(zeros) else zeros[:remaining]
    crc = zlib.crc32(chunk, crc)
    remaining -= len(chunk)
write_archive(padding_size, crc)
assert os.path.getsize(destination) == target
with zipfile.ZipFile(destination) as archive:
    assert archive.read("collection.anki2").startswith(b"SQLite format 3")
print(f"Created sparse ZIP64 fixture: {target} bytes; {os.stat(destination).st_blocks * 512} disk bytes")
