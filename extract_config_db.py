#!/usr/bin/env python3
import os
import sys
import subprocess
import shutil
import glob
import json
import urllib.request
import argparse

DEFAULT_REPAK = "/home/nozomi/Documents/Repos/repak/target/release/repak"
DEFAULT_PAKS = "/home/nozomi/.local/share/Steam/steamapps/common/Wuthering Waves/Client/Content/Paks"
KEYS_URL = "https://yarik0chka.github.io/wuwa-keys/keys.json"

def fetch_aes_key() -> str:
    print(f"Fetching AES key from {KEYS_URL}...")
    try:
        with urllib.request.urlopen(KEYS_URL, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
            key = data.get("mainKey")
            if key:
                print(f"  Successfully retrieved key: {key[:10]}...")
                return key
    except Exception as e:
        print(f"Error fetching AES key from URL: {e}")
    
    # Fallback to a prompt if URL fails
    print("Failed to fetch AES key automatically.")
    sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description="Extract Wuthering Waves ConfigDB SQLite files from game PAKs.")
    parser.add_argument("--repak", default=DEFAULT_REPAK, help=f"Path to repak executable (default: {DEFAULT_REPAK})")
    parser.add_argument("--paks", default=DEFAULT_PAKS, help=f"Path to game Paks directory (default: {DEFAULT_PAKS})")
    parser.add_argument("--output", help="Output directory path (default: ./WuwaDBExport)")
    parser.add_argument("--key", help="AES decryption key (hex string). Auto-fetched if not provided.")
    args = parser.parse_args()

    # Resolve paths
    repak_path = os.path.abspath(args.repak)
    paks_dir = os.path.abspath(args.paks)
    
    if not os.path.exists(repak_path):
        print(f"Error: repak executable not found at '{repak_path}'. Please specify with --repak.")
        sys.exit(1)
        
    if not os.path.exists(paks_dir):
        print(f"Error: game Paks directory not found at '{paks_dir}'. Please specify with --paks.")
        sys.exit(1)

    # Resolve AES key
    aes_key = args.key
    if not aes_key:
        aes_key = fetch_aes_key()

    # Determine output folder
    if args.output:
        output_dir = os.path.abspath(args.output)
    else:
        # Check parent folder name if we can find game version, else default to WuwaDBExport
        output_dir = os.path.join(os.getcwd(), "WuwaDBExport")

    print(f"Output directory: {output_dir}")

    # Step 1: Scan and find which paks contain Aki/ConfigDB
    pak_files = sorted(glob.glob(os.path.join(paks_dir, "*.pak")))
    paks_to_extract = []

    print("Scanning pak files to identify ConfigDB containers...")
    for pak in pak_files:
        cmd = [repak_path, "-a", aes_key, "list", pak]
        try:
            # We run list and only read stdout until we find a match or EOF
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            has_config_db = False
            for line in proc.stdout:
                if "Client/Content/Aki/ConfigDB/" in line:
                    has_config_db = True
                    break
            proc.kill()  # Close process early once found or scanned
            proc.wait()
            if has_config_db:
                paks_to_extract.append(pak)
                print(f"  Found ConfigDB in: {os.path.basename(pak)}")
        except Exception as e:
            pass

    if not paks_to_extract:
        print("Error: No pak files containing ConfigDB were found. Double check your AES key or paks path.")
        sys.exit(1)

    # We will extract to a temporary folder
    temp_extract_dir = os.path.join(os.getcwd(), "temp_extract_db")
    if os.path.exists(temp_extract_dir):
        shutil.rmtree(temp_extract_dir)
    os.makedirs(temp_extract_dir, exist_ok=True)

    # Prepare clean output directory
    if os.path.exists(output_dir):
        shutil.rmtree(output_dir)
    os.makedirs(output_dir, exist_ok=True)

    # Step 2: Unpack from the detected paks
    for pak_path in paks_to_extract:
        print(f"Unpacking ConfigDB from {os.path.basename(pak_path)}...")
        cmd = [
            repak_path,
            "-a", aes_key,
            "unpack",
            "-i", "Client/Content/Aki/ConfigDB/",
            "-o", temp_extract_dir,
            pak_path
        ]
        try:
            subprocess.run(cmd, check=True)
        except subprocess.CalledProcessError as e:
            print(f"Error unpacking {os.path.basename(pak_path)}: {e}")
            shutil.rmtree(temp_extract_dir)
            sys.exit(1)

    # Step 3: Reorganize files into output structure
    src_config_db = os.path.join(temp_extract_dir, "Client/Content/Aki/ConfigDB")
    if not os.path.exists(src_config_db):
        print(f"Error: Expected extracted directory {src_config_db} was not created.")
        shutil.rmtree(temp_extract_dir)
        sys.exit(1)

    target_base_dir = os.path.join(output_dir, "base")
    os.makedirs(target_base_dir, exist_ok=True)

    print("Organizing database files...")
    all_items = os.listdir(src_config_db)
    extracted_file_count = 0
    for item in all_items:
        item_path = os.path.join(src_config_db, item)
        if os.path.isfile(item_path):
            shutil.move(item_path, os.path.join(target_base_dir, item))
            extracted_file_count += 1
        elif os.path.isdir(item_path):
            # Language folder
            dest_lang_dir = os.path.join(output_dir, item)
            if os.path.exists(dest_lang_dir):
                # Merge files from different paks
                for subitem in os.listdir(item_path):
                    shutil.move(os.path.join(item_path, subitem), os.path.join(dest_lang_dir, subitem))
                shutil.rmtree(item_path)
            else:
                shutil.move(item_path, dest_lang_dir)

    # Step 4: Write export_log.txt
    log_path = os.path.join(output_dir, "export_log.txt")
    with open(log_path, "w") as f:
        f.write("===============================================\n")
        f.write("  Wuthering Waves ConfigDB Export Tool (repak)\n")
        f.write("===============================================\n")
        f.write(f"Source PAKs: {[os.path.basename(p) for p in paks_to_extract]}\n")
        f.write(f"AES Key: {aes_key}\n")
        f.write(f"Output Directory: {output_dir}\n")
        f.write(f"Base Databases: {extracted_file_count} files\n")

    print(f"\nSuccessfully extracted {extracted_file_count} base database/config files.")
    print(f"Output layout generated at: {output_dir}")
    print(f"Log written to: {log_path}")

    # Cleanup temp folder
    shutil.rmtree(temp_extract_dir)
    print("Extraction completed successfully.")

if __name__ == "__main__":
    main()
