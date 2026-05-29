// dllmain.cpp : Wuthering Waves ConfigDB Export + Native Dialogue Flow Exporter
// Injects into the game process and uses the game's own API to read & export data.
// After exporting ConfigDB files, uses SQLite3 C API to parse dialogue flows natively.

#include "pch.h"

// Save and undefine Windows macros that conflict with SDK symbol names
#pragma push_macro("CopyFile")
#pragma push_macro("DeleteFile")
#pragma push_macro("MoveFile")
#pragma push_macro("GetObject")
#pragma push_macro("DrawText")
#undef CopyFile
#undef DeleteFile
#undef MoveFile
#undef GetObject
#undef DrawText

#include "SDK.hpp"

// Restore Windows macros for our own Win32 calls
#pragma pop_macro("DrawText")
#pragma pop_macro("GetObject")
#pragma pop_macro("MoveFile")
#pragma pop_macro("DeleteFile")
#pragma pop_macro("CopyFile")

#include "sqlite3.h"
#include "DynamicResolver.hpp"

#include <string>
#include <vector>
#include <cstdio>
#include <unordered_map>
#include <unordered_set>
#include <map>
#include <set>
#include <algorithm>

using namespace SDK;

// ========================================================================
// SDK Utility Implementations (required by Dumper-7 generated SDK)
// ========================================================================
namespace SDK
{

namespace InSDKUtils
{
    uintptr_t GetImageBase()
    {
        static uintptr_t base = reinterpret_cast<uintptr_t>(GetModuleHandleW(NULL));
        return base;
    }
}

namespace BasicFilesImpleUtils
{
    UClass* FindClassByName(const std::string& Name, bool bByFullName)
    {
        if (bByFullName)
            return FindClassByFullName(Name);

        auto* GObj = UObject::GObjects.GetTypedPtr();
        if (!GObj) return nullptr;

        for (int32 i = 0; i < GObj->Num(); i++)
        {
            UObject* Obj = GObj->GetByIndex(i);
            if (!Obj || !Obj->Class) continue;
            if (!(Obj->Class->CastFlags & EClassCastFlags::Class)) continue;
            if (Obj->GetName() == Name)
                return static_cast<UClass*>(Obj);
        }
        return nullptr;
    }

    UClass* FindClassByFullName(const std::string& Name)
    {
        auto* GObj = UObject::GObjects.GetTypedPtr();
        if (!GObj) return nullptr;

        for (int32 i = 0; i < GObj->Num(); i++)
        {
            UObject* Obj = GObj->GetByIndex(i);
            if (!Obj || !Obj->Class) continue;
            if (!(Obj->Class->CastFlags & EClassCastFlags::Class)) continue;
            if (Obj->GetFullName() == Name)
                return static_cast<UClass*>(Obj);
        }
        return nullptr;
    }

    std::string GetObjectName(UClass* Class)
    {
        return Class ? Class->GetName() : "";
    }

    int32 GetObjectIndex(UClass* Class)
    {
        return Class ? Class->Index : 0;
    }

    uint64 GetObjFNameAsUInt64(UClass* Class)
    {
        if (!Class) return 0;
        // FName is 12 bytes, copy first 8 bytes as uint64 identifier
        uint64 result = 0;
        memcpy(&result, &Class->Name, sizeof(uint64));
        return result;
    }

    UObject* GetObjectByIndex(int32 Index)
    {
        return UObject::GObjects->GetByIndex(Index);
    }

    UFunction* FindFunctionByFName(const FName* Name)
    {
        if (!Name) return nullptr;
        auto* GObj = UObject::GObjects.GetTypedPtr();
        if (!GObj) return nullptr;

        for (int32 i = 0; i < GObj->Num(); i++)
        {
            UObject* Obj = GObj->GetByIndex(i);
            if (!Obj || !Obj->Class) continue;
            if ((Obj->Class->CastFlags & EClassCastFlags::Function) && Obj->Name == *Name)
                return static_cast<UFunction*>(Obj);
        }
        return nullptr;
    }

    FName StringToName(const wchar_t* NameStr)
    {
        // Convert wide string to UTF-8, then search GObjects for an object with matching name
        if (!NameStr) return FName();

        std::string targetUtf8 = UtfN::Utf16StringToUtf8String<std::string>(NameStr, static_cast<int>(wcslen(NameStr)));

        auto* GObj = UObject::GObjects.GetTypedPtr();
        if (!GObj) return FName();

        for (int32 i = 0; i < GObj->Num(); i++)
        {
            UObject* Obj = GObj->GetByIndex(i);
            if (!Obj) continue;
            if (Obj->Name.GetRawString() == targetUtf8)
                return Obj->Name;
        }
        return FName();
    }
}

const FName& GetStaticName(const wchar_t* NameStr, FName& StaticNameRef)
{
    if (StaticNameRef.IsNone())
    {
        StaticNameRef = BasicFilesImpleUtils::StringToName(NameStr);
    }
    return StaticNameRef;
}

// FWeakObjectPtr implementations
UObject* FWeakObjectPtr::Get() const
{
    if (ObjectIndex < 0) return nullptr;
    return UObject::GObjects->GetByIndex(ObjectIndex);
}

UObject* FWeakObjectPtr::operator->() const
{
    return Get();
}

bool FWeakObjectPtr::operator==(const FWeakObjectPtr& Other) const
{
    return ObjectIndex == Other.ObjectIndex && ObjectSerialNumber == Other.ObjectSerialNumber;
}

bool FWeakObjectPtr::operator!=(const FWeakObjectPtr& Other) const
{
    return !(*this == Other);
}

bool FWeakObjectPtr::operator==(const UObject* Other) const
{
    return Get() == Other;
}

bool FWeakObjectPtr::operator!=(const UObject* Other) const
{
    return Get() != Other;
}

} // namespace SDK

// ========================================================================
// Logging
// ========================================================================
static FILE* g_logFile = nullptr;

static void Log(const char* fmt, ...)
{
    char buf[4096];
    va_list args;
    va_start(args, fmt);
    vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);

    printf("[WuwaExport] %s\n", buf);

    if (g_logFile)
    {
        fprintf(g_logFile, "%s\n", buf);
        fflush(g_logFile);
    }
}

// ========================================================================
// Utility helpers
// ========================================================================

// Normalize UE4 forward-slash paths to Windows backslash paths
static std::wstring NormalizePath(const std::wstring& path)
{
    std::wstring result = path;
    for (auto& c : result)
    {
        if (c == L'/') c = L'\\';
    }
    return result;
}

// Recursively create directories
static void CreateDirRecursive(const std::wstring& path)
{
    std::wstring normalized = NormalizePath(path);
    size_t pos = 0;
    while ((pos = normalized.find(L'\\', pos + 1)) != std::wstring::npos)
    {
        CreateDirectoryW(normalized.substr(0, pos).c_str(), NULL);
    }
    CreateDirectoryW(normalized.c_str(), NULL);
}

// Recursively delete a directory and all its contents (removes stale export files)
static void DeleteDirRecursive(const std::wstring& path)
{
    std::wstring pattern = path + L"\\*";
    WIN32_FIND_DATAW fd;
    HANDLE h = FindFirstFileW(pattern.c_str(), &fd);
    if (h == INVALID_HANDLE_VALUE) return;
    do {
        if (fd.cFileName[0] == L'.' &&
            (fd.cFileName[1] == L'\0' || (fd.cFileName[1] == L'.' && fd.cFileName[2] == L'\0')))
            continue;
        std::wstring child = path + L"\\" + fd.cFileName;
        if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)
            DeleteDirRecursive(child);
        else
            DeleteFileW(child.c_str());
    } while (FindNextFileW(h, &fd));
    FindClose(h);
    RemoveDirectoryW(path.c_str());
}

// Get output directory on Desktop
static std::wstring GetOutputDir()
{
    wchar_t userProfile[MAX_PATH] = {};
    GetEnvironmentVariableW(L"USERPROFILE", userProfile, MAX_PATH);
    return std::wstring(userProfile) + L"\\Desktop\\WuwaDBExport";
}

// Initialize SDK with dynamic offset resolution.
// Scans for GObjects, AppendString, and ProcessEvent at runtime.
static bool InitializeSDK(int timeoutSeconds)
{
    return DynamicResolver::ResolveAndInitSDK(timeoutSeconds, Log);
}

// ========================================================================
// Database file extraction via UE4 virtual filesystem
// ========================================================================

// Mount PAK helpers — isolated in SEH-safe functions (no C++ objects)
static bool TryMountGamePaks()
{
    __try { UKuroPakMountStatic::MountGamePaks(); return true; }
    __except (EXCEPTION_EXECUTE_HANDLER) { return false; }
}

static bool TryMountMultiLangPaks()
{
    __try { UKuroPakMountStatic::MountMultiLangPaks(); return true; }
    __except (EXCEPTION_EXECUTE_HANDLER) { return false; }
}

// MountPak wrapper — MountPak + RemoveSha1Check
static bool MountSinglePak(const wchar_t* path)
{
    FString fPath(path);
    UKuroPakMountStatic::MountPak(fPath, 100);
    UKuroPakMountStatic::RemoveSha1Check(fPath);
    return true;
}

// Scan a directory recursively for pakchunk*.pak files
static void FindPakFiles(const std::wstring& dir, std::vector<std::wstring>& results)
{
    WIN32_FIND_DATAW fd;
    HANDLE hFind = FindFirstFileW((dir + L"\\*").c_str(), &fd);
    if (hFind == INVALID_HANDLE_VALUE) return;

    do
    {
        std::wstring name = fd.cFileName;
        if (name == L"." || name == L"..") continue;

        std::wstring fullPath = dir + L"\\" + name;

        if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)
        {
            FindPakFiles(fullPath, results);
        }
        else
        {
            // Match pakchunk*.pak (case-insensitive)
            std::wstring lower = name;
            for (auto& c : lower) c = towlower(c);
            if (lower.size() > 12 && lower.substr(0, 8) == L"pakchunk" && lower.substr(lower.size() - 4) == L".pak")
            {
                results.push_back(fullPath);
            }
        }
    } while (FindNextFileW(hFind, &fd));
    FindClose(hFind);
}

// Mount all pakchunk*.pak files found under the Client directory
static void MountAllPakChunks()
{
    // Derive Client dir from content dir:
    // Content = .../Client/Content/  ->  Client = .../Client
    FString contentDirFS = UKismetSystemLibrary::GetProjectContentDirectory();
    std::wstring contentDir = contentDirFS.ToWString();
    // Normalize to backslashes and remove trailing slash
    std::wstring clientDir = contentDir;
    for (auto& c : clientDir) if (c == L'/') c = L'\\';
    while (!clientDir.empty() && clientDir.back() == L'\\') clientDir.pop_back();
    // Go up from Content to Client
    size_t pos = clientDir.find_last_of(L'\\');
    if (pos != std::wstring::npos)
        clientDir = clientDir.substr(0, pos);

    Log("Scanning for PAK files in: %ls", clientDir.c_str());

    std::vector<std::wstring> pakFiles;
    FindPakFiles(clientDir, pakFiles);

    Log("Found %d pakchunk*.pak file(s)", static_cast<int>(pakFiles.size()));

    int mounted = 0;
    for (const auto& pakPath : pakFiles)
    {
        if (MountSinglePak(pakPath.c_str()))
        {
            mounted++;
        }
        else
        {
            Log("  FAILED to mount: %ls", pakPath.c_str());
        }
    }
    Log("Mounted %d / %d PAK files", mounted, static_cast<int>(pakFiles.size()));
}

// ========================================================================
// Main export orchestration
// ========================================================================
static void ExportAllDatabases()
{
    std::wstring outputDir = GetOutputDir();
    CreateDirRecursive(outputDir);

    // Open log file
    std::wstring logPath = outputDir + L"\\export_log.txt";
    _wfopen_s(&g_logFile, logPath.c_str(), L"w");

    Log("===============================================");
    Log("  Wuthering Waves ConfigDB Export Tool");
    Log("===============================================");
    Log("Output: %ls", outputDir.c_str());

    // Get content directory from UE4 engine
    FString contentDirFS = UKismetSystemLibrary::GetProjectContentDirectory();
    std::wstring contentDirW = contentDirFS.ToWString();
    std::string contentDirUtf8 = contentDirFS.ToString();

    Log("Content directory: %s", contentDirUtf8.c_str());

    // Mount PAKs once (before processing any locale)
    {
        std::wstring dbDirUE = contentDirW;
        if (!dbDirUE.empty() && dbDirUE.back() != L'/' && dbDirUE.back() != L'\\')
            dbDirUE += L'/';
        dbDirUE += L"Aki/ConfigDB/zh-Hans";
        FString fDbDir(dbDirUE.c_str());
        FString fExt(L"db");
        TArray<FString> probe = UKuroStaticLibrary::FindFilesSorted(fDbDir, fExt);
        Log("Initial probe: %d file(s)", probe.Num());
    }

    Log("Mounting PAK archives...");
    if (TryMountGamePaks()) Log("  MountGamePaks() OK");
    else Log("  MountGamePaks() failed (exception)");

    if (TryMountMultiLangPaks()) Log("  MountMultiLangPaks() OK");
    else Log("  MountMultiLangPaks() failed (exception)");

    MountAllPakChunks();

    // Define locales to export
    struct LocaleInfo {
        const wchar_t* subdir;   // e.g. "zh-Hans", "en"
        const wchar_t* label;    // display name
        const wchar_t* outName;  // output folder name
    };
    LocaleInfo locales[] = {
        { L"",        L"Base (no locale)", L"base"    },
        { L"zh-Hans", L"Chinese (zh-Hans)", L"zh-Hans" },
        { L"en",      L"English (en)",      L"en"      },
        { L"ja",      L"Japanese (ja)",     L"ja"      },
    };

    int totalSuccess = 0;

    for (const auto& locale : locales)
    {
        Log("");
        Log("-----------------------------------------------");
        Log("  Locale: %ls", locale.label);
        Log("-----------------------------------------------");

        // Build UE4 path for this locale
        std::wstring dbDirUE = contentDirW;
        if (!dbDirUE.empty() && dbDirUE.back() != L'/' && dbDirUE.back() != L'\\')
            dbDirUE += L'/';
        dbDirUE += L"Aki/ConfigDB";
        if (wcslen(locale.subdir) > 0)
        {
            dbDirUE += L"/";
            dbDirUE += locale.subdir;
        }

        Log("DB directory: %ls", dbDirUE.c_str());

        // Create locale output subdirectory
        std::wstring localeOutputDir = outputDir + L"\\" + locale.outName;
        CreateDirRecursive(localeOutputDir);

        // Enumerate files
        FString fDbDir(dbDirUE.c_str());
        FString fExt(L"db");
        TArray<FString> ueFiles = UKuroStaticLibrary::FindFilesSorted(fDbDir, fExt);
        Log("Found %d file(s)", ueFiles.Num());

        int successCount = 0;
        int failCount = 0;

        for (int32 i = 0; i < ueFiles.Num(); i++)
        {
            std::wstring ueFilePath = ueFiles[i].ToWString();

            size_t lastSlash = ueFilePath.find_last_of(L"/\\");
            std::wstring fileName = (lastSlash != std::wstring::npos)
                ? ueFilePath.substr(lastSlash + 1) : ueFilePath;

            Log("[%d/%d] %ls", i + 1, ueFiles.Num(), fileName.c_str());

            std::wstring fullPath = dbDirUE + L"/" + fileName;

            TArray<uint8> fileData;
            FString fPath(fullPath.c_str());
            bool loaded = UKuroStaticLibrary::LoadFileToArray(fPath, &fileData);

            if (!loaded || fileData.Num() == 0)
            {
                Log("  FAILED: LoadFileToArray returned empty");
                failCount++;
                continue;
            }

            std::wstring outFile = localeOutputDir + L"\\" + fileName;
            HANDLE hFile = CreateFileW(outFile.c_str(), GENERIC_WRITE, 0, NULL,
                                       CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
            if (hFile == INVALID_HANDLE_VALUE)
            {
                Log("  FAILED: Cannot create output file");
                failCount++;
                continue;
            }

            DWORD written = 0;
            ::WriteFile(hFile, fileData.GetDataPtr(), static_cast<DWORD>(fileData.Num()), &written, NULL);
            CloseHandle(hFile);

            Log("  OK: %d bytes -> %ls", fileData.Num(), fileName.c_str());
            successCount++;
        }

        Log("Enumerated: %d OK, %d failed", successCount, failCount);

        Log("Locale %ls total: %d files", locale.outName, successCount);
        totalSuccess += successCount;
    }

    Log("");
    Log("Total exported across all locales: %d files", totalSuccess);

    Log("===============================================");
    Log("  Export Complete!");
    Log("  Output: %ls", outputDir.c_str());
    Log("===============================================");

    if (g_logFile)
    {
        fclose(g_logFile);
        g_logFile = nullptr;
    }
}

// ========================================================================
// Native Dialogue Flow Exporter (SQLite3 C API)
// ========================================================================

// Minimal JSON writer (no external dependency)
class JsonWriter {
    std::string m_buf;
    bool m_needComma = false;
    int m_indent = 0;

    void Indent() { for (int i = 0; i < m_indent; i++) m_buf += "  "; }
    void Sep() { if (m_needComma) m_buf += ","; m_buf += "\n"; }

public:
    void BeginObject() { Sep(); Indent(); m_buf += "{"; m_indent++; m_needComma = false; }
    void EndObject()   { m_indent--; m_buf += "\n"; Indent(); m_buf += "}"; m_needComma = true; }
    void BeginArray()  { Sep(); Indent(); m_buf += "["; m_indent++; m_needComma = false; }
    void EndArray()    { m_indent--; m_buf += "\n"; Indent(); m_buf += "]"; m_needComma = true; }

    void Key(const char* k) {
        Sep(); Indent();
        m_buf += "\""; WriteEscaped(k); m_buf += "\": ";
        m_needComma = false;
    }

    void ValueString(const char* v) {
        if (m_needComma) { m_buf += ",\n"; Indent(); }
        m_buf += "\""; WriteEscaped(v); m_buf += "\"";
        m_needComma = true;
    }

    void ValueInt(int v) {
        if (m_needComma) { m_buf += ",\n"; Indent(); }
        char tmp[32]; snprintf(tmp, sizeof(tmp), "%d", v);
        m_buf += tmp;
        m_needComma = true;
    }

    // Key + string value on same line
    void KV(const char* k, const char* v) { Key(k); ValueString(v); }
    void KV(const char* k, const std::string& v) { KV(k, v.c_str()); }
    void KV(const char* k, int v) { Key(k); ValueInt(v); }

    const std::string& Str() const { return m_buf; }

private:
    void WriteEscaped(const char* s) {
        for (; *s; s++) {
            switch (*s) {
                case '"':  m_buf += "\\\""; break;
                case '\\': m_buf += "\\\\"; break;
                case '\n': m_buf += "\\n";  break;
                case '\r': m_buf += "\\r";  break;
                case '\t': m_buf += "\\t";  break;
                default:
                    if ((unsigned char)*s < 0x20)
                        { char h[8]; snprintf(h,8,"\\u%04x",(unsigned char)*s); m_buf += h; }
                    else
                        m_buf += *s;
            }
        }
    }
};

// Minimal JSON parser — just enough to extract Actions array from FlatBuffer BinData
// BinData contains FlatBuffer with embedded JSON string starting at "[{"
struct JsonValue;
using JsonArray = std::vector<JsonValue>;
using JsonObject = std::vector<std::pair<std::string, JsonValue>>;

struct JsonValue {
    enum Type { Null, String, Number, Bool, Array, Object } type = Null;
    std::string str;
    double num = 0;
    bool boolean = false;
    JsonArray arr;
    JsonObject obj;

    const JsonValue* Find(const char* key) const {
        if (type != Object) return nullptr;
        for (auto& kv : obj)
            if (kv.first == key) return &kv.second;
        return nullptr;
    }

    const char* GetStr(const char* key, const char* def = "") const {
        auto* v = Find(key);
        return (v && v->type == String) ? v->str.c_str() : def;
    }

    int GetInt(const char* key, int def = 0) const {
        auto* v = Find(key);
        return (v && v->type == Number) ? (int)v->num : def;
    }

    const JsonArray* GetArr(const char* key) const {
        auto* v = Find(key);
        return (v && v->type == Array) ? &v->arr : nullptr;
    }

    const JsonObject* GetObj(const char* key) const {
        auto* v = Find(key);
        return (v && v->type == Object) ? &v->obj : nullptr;
    }
};

class JsonParser {
    const char* p;
    const char* end;

    void SkipWS() { while (p < end && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')) p++; }

    std::string ParseString() {
        if (*p != '"') return "";
        p++; // skip opening quote
        std::string s;
        while (p < end && *p != '"') {
            if (*p == '\\' && p + 1 < end) {
                p++;
                switch (*p) {
                    case '"': s += '"'; break;
                    case '\\': s += '\\'; break;
                    case '/': s += '/'; break;
                    case 'n': s += '\n'; break;
                    case 'r': s += '\r'; break;
                    case 't': s += '\t'; break;
                    case 'u': {
                        if (p + 4 < end) {
                            char hex[5] = {p[1],p[2],p[3],p[4],0};
                            unsigned cp = (unsigned)strtoul(hex, nullptr, 16);
                            p += 4;
                            // UTF-8 encode
                            if (cp < 0x80) s += (char)cp;
                            else if (cp < 0x800) { s += (char)(0xC0|(cp>>6)); s += (char)(0x80|(cp&0x3F)); }
                            else { s += (char)(0xE0|(cp>>12)); s += (char)(0x80|((cp>>6)&0x3F)); s += (char)(0x80|(cp&0x3F)); }
                        }
                        break;
                    }
                    default: s += *p;
                }
            } else {
                s += *p;
            }
            p++;
        }
        if (p < end) p++; // skip closing quote
        return s;
    }

    double ParseNumber() {
        const char* start = p;
        if (*p == '-') p++;
        while (p < end && *p >= '0' && *p <= '9') p++;
        if (p < end && *p == '.') { p++; while (p < end && *p >= '0' && *p <= '9') p++; }
        if (p < end && (*p == 'e' || *p == 'E')) { p++; if (p < end && (*p == '+' || *p == '-')) p++; while (p < end && *p >= '0' && *p <= '9') p++; }
        return strtod(start, nullptr);
    }

public:
    bool Parse(const char* json, size_t len, JsonValue& out) {
        p = json; end = json + len;
        return ParseValue(out);
    }

    bool ParseValue(JsonValue& v) {
        SkipWS();
        if (p >= end) return false;
        if (*p == '"') { v.type = JsonValue::String; v.str = ParseString(); return true; }
        if (*p == '{') { v.type = JsonValue::Object; return ParseObj(v.obj); }
        if (*p == '[') { v.type = JsonValue::Array; return ParseArr(v.arr); }
        if (*p == 't' || *p == 'f') { v.type = JsonValue::Bool; v.boolean = (*p == 't'); while (p < end && *p >= 'a' && *p <= 'z') p++; return true; }
        if (*p == 'n') { v.type = JsonValue::Null; p += 4; return true; }
        v.type = JsonValue::Number; v.num = ParseNumber(); return true;
    }

    bool ParseObj(JsonObject& obj) {
        p++; // skip {
        SkipWS();
        if (p < end && *p == '}') { p++; return true; }
        while (p < end) {
            SkipWS();
            std::string key = ParseString();
            SkipWS();
            if (p < end && *p == ':') p++;
            JsonValue val;
            if (!ParseValue(val)) return false;
            obj.push_back({std::move(key), std::move(val)});
            SkipWS();
            if (p < end && *p == ',') { p++; continue; }
            if (p < end && *p == '}') { p++; return true; }
            return false;
        }
        return false;
    }

    bool ParseArr(JsonArray& arr) {
        p++; // skip [
        SkipWS();
        if (p < end && *p == ']') { p++; return true; }
        while (p < end) {
            JsonValue val;
            if (!ParseValue(val)) return false;
            arr.push_back(std::move(val));
            SkipWS();
            if (p < end && *p == ',') { p++; continue; }
            if (p < end && *p == ']') { p++; return true; }
            return false;
        }
        return false;
    }
};

// Extract embedded JSON from FlatBuffer BinData (find "[{" marker)
static std::string ExtractActionsJson(const unsigned char* data, int len)
{
    // Search for "[{" which marks the start of the Actions JSON array
    for (int i = 0; i < len - 1; i++)
    {
        if (data[i] == '[' && data[i + 1] == '{')
        {
            // Find the matching "]"
            const char* start = reinterpret_cast<const char*>(data + i);
            int remaining = len - i;

            // Try to find last ']'
            for (int j = remaining - 1; j > 0; j--)
            {
                if (start[j] == ']')
                    return std::string(start, j + 1);
            }
        }
    }
    return "";
}

// Language pack: holds SQLite connections for one language
struct LangPack {
    sqlite3* conn_spk = nullptr;     // lang_speaker.db
    sqlite3* conn_mt = nullptr;      // lang_multi_text.db
    sqlite3* conn_mt1 = nullptr;     // lang_multi_text_1sthalf.db
    sqlite3* conn_mt2 = nullptr;     // lang_multi_text_2ndhalf.db
    std::string suffix;              // "en", "ja", "zh"
    std::unordered_map<std::string, std::string> txtCache;
    std::unordered_map<int, std::string> spkCache;

    bool Open(const std::wstring& baseDir, const char* sfx) {
        suffix = sfx;
        std::string dir;
        {
            // Wide to UTF-8
            int sz = WideCharToMultiByte(CP_UTF8, 0, baseDir.c_str(), -1, nullptr, 0, nullptr, nullptr);
            dir.resize(sz - 1);
            WideCharToMultiByte(CP_UTF8, 0, baseDir.c_str(), -1, dir.data(), sz, nullptr, nullptr);
        }

        auto OpenDB = [](const std::string& path, sqlite3** db) -> bool {
            return sqlite3_open_v2(path.c_str(), db, SQLITE_OPEN_READONLY, nullptr) == SQLITE_OK;
        };

        bool ok = true;
        if (!OpenDB(dir + "\\lang_speaker.db", &conn_spk)) { Log("  WARN: Cannot open lang_speaker.db for %s", sfx); ok = false; }
        if (!OpenDB(dir + "\\lang_multi_text.db", &conn_mt)) { Log("  WARN: Cannot open lang_multi_text.db for %s", sfx); ok = false; }
        OpenDB(dir + "\\lang_multi_text_1sthalf.db", &conn_mt1); // optional
        OpenDB(dir + "\\lang_multi_text_2ndhalf.db", &conn_mt2); // optional
        return ok;
    }

    void Close() {
        if (conn_spk) { sqlite3_close(conn_spk); conn_spk = nullptr; }
        if (conn_mt)  { sqlite3_close(conn_mt);  conn_mt = nullptr; }
        if (conn_mt1) { sqlite3_close(conn_mt1); conn_mt1 = nullptr; }
        if (conn_mt2) { sqlite3_close(conn_mt2); conn_mt2 = nullptr; }
    }

    std::string GetText(const std::string& tid) {
        if (tid.empty()) return "";
        auto it = txtCache.find(tid);
        if (it != txtCache.end()) return it->second;

        // Query all DBs in order; later DBs (1sthalf, 2ndhalf) overwrite earlier
        // results. This mirrors the Python LangPack which loads all DBs and lets
        // later entries overwrite — critical because the main lang_multi_text.db
        // can contain asterisk placeholders for keys that only have real text in
        // the 1sthalf/2ndhalf databases.
        sqlite3* dbs[] = { conn_mt, conn_mt1, conn_mt2 };
        std::string best = "";
        for (auto* db : dbs) {
            if (!db) continue;
            sqlite3_stmt* stmt = nullptr;
            if (sqlite3_prepare_v2(db, "SELECT Content FROM MultiText WHERE Id = ?", -1, &stmt, nullptr) == SQLITE_OK) {
                sqlite3_bind_text(stmt, 1, tid.c_str(), -1, SQLITE_STATIC);
                if (sqlite3_step(stmt) == SQLITE_ROW) {
                    const char* txt = (const char*)sqlite3_column_text(stmt, 0);
                    if (txt && *txt) best = txt;  // overwrite with each non-empty find
                }
                sqlite3_finalize(stmt);
            }
        }
        txtCache[tid] = best;
        return best;
    }

    std::string GetSpeakerName(int idx) {
        auto it = spkCache.find(idx);
        if (it != spkCache.end()) return it->second;
        if (!conn_spk) { spkCache[idx] = ""; return ""; }

        sqlite3_stmt* stmt = nullptr;
        if (sqlite3_prepare_v2(conn_spk, "SELECT Content FROM Speaker WHERE Id = ?", -1, &stmt, nullptr) == SQLITE_OK) {
            sqlite3_bind_int(stmt, 1, idx);
            if (sqlite3_step(stmt) == SQLITE_ROW) {
                const char* txt = (const char*)sqlite3_column_text(stmt, 0);
                std::string result = txt ? txt : "";
                sqlite3_finalize(stmt);
                spkCache[idx] = result;
                return result;
            }
            sqlite3_finalize(stmt);
        }
        spkCache[idx] = "";
        return "";
    }
};

// Speaker resolution: SpeakerId -> multi-language names
struct SpeakerInfo {
    int nameStringKey = -1;
    int nameIdx = -1;
};

static std::unordered_map<int, SpeakerInfo> g_speakerMap;

static void LoadSpeakerMap(const std::wstring& baseDbDir)
{
    std::string dir;
    {
        int sz = WideCharToMultiByte(CP_UTF8, 0, baseDbDir.c_str(), -1, nullptr, 0, nullptr, nullptr);
        dir.resize(sz - 1);
        WideCharToMultiByte(CP_UTF8, 0, baseDbDir.c_str(), -1, dir.data(), sz, nullptr, nullptr);
    }

    sqlite3* db = nullptr;
    if (sqlite3_open_v2((dir + "\\db_speaker.db").c_str(), &db, SQLITE_OPEN_READONLY, nullptr) != SQLITE_OK)
    {
        Log("  WARN: Cannot open db_speaker.db");
        return;
    }

    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db, "SELECT Id, NameStringKey FROM speaker", -1, &stmt, nullptr) == SQLITE_OK)
    {
        while (sqlite3_step(stmt) == SQLITE_ROW)
        {
            int id = sqlite3_column_int(stmt, 0);
            SpeakerInfo si;
            si.nameStringKey = sqlite3_column_int(stmt, 1);
            si.nameIdx = -1; // No longer present in db_speaker.db schema
            g_speakerMap[id] = si;
        }
        sqlite3_finalize(stmt);
    }
    sqlite3_close(db);
    Log("  Loaded %d speakers from db_speaker.db", (int)g_speakerMap.size());
}

struct LangSuffix {
    const char* lang;    // "en", "ja", "zh-Hans"
    const char* suffix;  // "en", "ja", "zh"
};

static const LangSuffix LANGUAGES[] = {
    { "en",      "en" },
    { "ja",      "ja" },
    { "zh-Hans", "zh" },
};
static const int NUM_LANGS = 3;
static const int ZH_IDX    = 2;  // index of zh-Hans in LANGUAGES / packs[]

static void GetSpeakerML(int whoId, LangPack packs[], std::string names[/*NUM_LANGS*/])
{
    if (whoId == 0)
    {
        for (int i = 0; i < NUM_LANGS; i++)
            names[i] = "{PlayerName}";
        return;
    }

    auto sit = g_speakerMap.find(whoId);
    bool hasSpeakerInfo = (sit != g_speakerMap.end());

    std::string zhTextKey = "";
    bool zhKeyValid = false;
    if (hasSpeakerInfo)
    {
        const SpeakerInfo& si = sit->second;
        zhTextKey = packs[ZH_IDX].GetSpeakerName(si.nameStringKey);
        zhKeyValid = !zhTextKey.empty() && zhTextKey.find("_Name") != std::string::npos;
    }

    for (int i = 0; i < NUM_LANGS; i++)
    {
        // Priority 1: stable text key from zh-Hans NSK -> per-lang lang_multi_text
        if (zhKeyValid)
        {
            std::string name = packs[i].GetText(zhTextKey);
            if (!name.empty()) { names[i] = name; continue; }
        }

        // Priority 2: constructed "Speaker_{whoId}_Name" -> lang_multi_text.
        // Cross-language stable fallback (same key resolves correctly in all MT DBs).
        char fbKey[64]; snprintf(fbKey, sizeof(fbKey), "Speaker_%d_Name", whoId);
        std::string byKey = packs[i].GetText(fbKey);
        if (!byKey.empty()) { names[i] = byKey; continue; }

        // Priority 3: nameIdx -> per-language lang_speaker.
        // Last resort for NPCs that are only in lang_speaker, not lang_multi_text.
        // Note: en/ja lang_speaker IDs may be misaligned vs zh-Hans; this can
        // still give wrong names for recently-added speakers in those locales.
        if (hasSpeakerInfo)
        {
            const SpeakerInfo& si = sit->second;
            if (si.nameIdx >= 0)
            {
                std::string direct = packs[i].GetSpeakerName(si.nameIdx);
                if (!direct.empty()) { names[i] = direct; continue; }
            }
        }

        char buf[64]; snprintf(buf, sizeof(buf), "[Speaker:%d]", whoId);
        names[i] = buf;
    }
}

static void GetTextML(const std::string& tid, LangPack packs[], std::string texts[/*NUM_LANGS*/])
{
    for (int i = 0; i < NUM_LANGS; i++)
        texts[i] = packs[i].GetText(tid);
}

// File name sanitizer (operates on UTF-8 string, removes illegal Win32 chars)
static std::string SanitizeFileName(const std::string& name)
{
    std::string result = name;
    for (auto& c : result)
    {
        if (c == '<' || c == '>' || c == ':' || c == '"' || c == '/' || c == '\\' || c == '|' || c == '?' || c == '*')
            c = '_';
    }
    return result;
}

// UTF-8 → wide string
static std::wstring Utf8ToWide(const std::string& utf8)
{
    if (utf8.empty()) return {};
    int sz = MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), -1, nullptr, 0);
    std::wstring w(sz - 1, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), -1, w.data(), sz);
    return w;
}

// Wide-to-UTF8 helper
static std::string WToUtf8(const std::wstring& w)
{
    if (w.empty()) return "";
    int sz = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), -1, nullptr, 0, nullptr, nullptr);
    std::string s(sz - 1, '\0');
    WideCharToMultiByte(CP_UTF8, 0, w.c_str(), -1, s.data(), sz, nullptr, nullptr);
    return s;
}

static void ExportDialogueFlows()
{
    std::wstring exportDir = GetOutputDir();

    Log("===============================================");
    Log("  Native Dialogue Flow Export");
    Log("===============================================");

    // Check that ConfigDB files exist
    std::wstring baseDir = exportDir + L"\\base";
    std::wstring fsPath = baseDir + L"\\db_flowState.db";
    if (GetFileAttributesW(fsPath.c_str()) == INVALID_FILE_ATTRIBUTES)
    {
        Log("ERROR: %ls not found. Run ConfigDB export first!", fsPath.c_str());
        return;
    }

    // Load speaker map from base/db_speaker.db
    g_speakerMap.clear();
    LoadSpeakerMap(baseDir);

    // Open language packs
    LangPack packs[NUM_LANGS];
    for (int i = 0; i < NUM_LANGS; i++)
    {
        std::wstring langDir = exportDir + L"\\" +
            std::wstring(LANGUAGES[i].lang, LANGUAGES[i].lang + strlen(LANGUAGES[i].lang));
        if (!packs[i].Open(langDir, LANGUAGES[i].suffix))
            Log("  WARNING: Some databases missing for language '%s'", LANGUAGES[i].lang);
    }

    // Open db_flowState.db
    std::string fsPathUtf8 = WToUtf8(fsPath);
    sqlite3* dbFS = nullptr;
    if (sqlite3_open_v2(fsPathUtf8.c_str(), &dbFS, SQLITE_OPEN_READONLY, nullptr) != SQLITE_OK)
    {
        Log("ERROR: Cannot open db_flowState.db");
        for (int i = 0; i < NUM_LANGS; i++) packs[i].Close();
        return;
    }

    // Read all flowstate entries
    struct FlowEntry {
        std::string stateKey;
        std::vector<unsigned char> binData;
    };

    std::vector<FlowEntry> allEntries;
    {
        sqlite3_stmt* stmt = nullptr;
        if (sqlite3_prepare_v2(dbFS, "SELECT StateKey, BinData FROM flowstate ORDER BY StateKey", -1, &stmt, nullptr) == SQLITE_OK)
        {
            while (sqlite3_step(stmt) == SQLITE_ROW)
            {
                FlowEntry e;
                const char* sk = (const char*)sqlite3_column_text(stmt, 0);
                e.stateKey = sk ? sk : "";
                const void* blob = sqlite3_column_blob(stmt, 1);
                int blobLen = sqlite3_column_bytes(stmt, 1);
                if (blob && blobLen > 0)
                    e.binData.assign((const unsigned char*)blob, (const unsigned char*)blob + blobLen);
                allEntries.push_back(std::move(e));
            }
            sqlite3_finalize(stmt);
        }
    }
    sqlite3_close(dbFS);
    Log("  Loaded %d flow states", (int)allEntries.size());

    // Group by flow name (remove last _N_M suffix)
    struct FlowGroup {
        std::string name;
        std::vector<const FlowEntry*> entries;
    };
    std::unordered_map<std::string, int> groupIndex;
    std::vector<FlowGroup> groups;

    for (auto& e : allEntries)
    {
        // Parse flow group: "剧情_XXX_N_M" -> group = "剧情_XXX"
        std::string flowGroup = e.stateKey;
        // Try removing last two _digit segments
        size_t last = flowGroup.rfind('_');
        if (last != std::string::npos)
        {
            bool allDigit = true;
            for (size_t j = last + 1; j < flowGroup.size(); j++)
                if (flowGroup[j] < '0' || flowGroup[j] > '9') { allDigit = false; break; }
            if (allDigit)
            {
                std::string trimmed = flowGroup.substr(0, last);
                size_t prev = trimmed.rfind('_');
                if (prev != std::string::npos)
                {
                    bool allDigit2 = true;
                    for (size_t j = prev + 1; j < trimmed.size(); j++)
                        if (trimmed[j] < '0' || trimmed[j] > '9') { allDigit2 = false; break; }
                    if (allDigit2)
                        flowGroup = trimmed.substr(0, prev);
                    else
                        flowGroup = trimmed;
                }
                else
                    flowGroup = trimmed;
            }
        }

        auto it = groupIndex.find(flowGroup);
        if (it == groupIndex.end())
        {
            groupIndex[flowGroup] = (int)groups.size();
            FlowGroup g;
            g.name = flowGroup;
            g.entries.push_back(&e);
            groups.push_back(std::move(g));
        }
        else
        {
            groups[it->second].entries.push_back(&e);
        }
    }
    Log("  Grouped into %d flows", (int)groups.size());

    // Create output directory
    std::wstring outDir = exportDir + L"\\export_dialogue";
    CreateDirRecursive(outDir);

    int exported = 0, skipped = 0;
    JsonParser parser;

    for (auto& group : groups)
    {
        JsonWriter jw;
        jw.BeginObject();
        jw.KV("flow_name", group.name);

        jw.Key("languages");
        jw.BeginArray();
        for (int i = 0; i < NUM_LANGS; i++)
            jw.ValueString(LANGUAGES[i].suffix);
        jw.EndArray();

        jw.KV("total_states", (int)group.entries.size());

        bool hasDialogue = false;
        jw.Key("states");
        jw.BeginArray();

        for (auto* entry : group.entries)
        {
            if (entry->binData.empty()) continue;

            std::string actionsJson = ExtractActionsJson(entry->binData.data(), (int)entry->binData.size());
            if (actionsJson.empty()) continue;

            JsonValue root;
            if (!parser.Parse(actionsJson.c_str(), actionsJson.size(), root)) continue;
            if (root.type != JsonValue::Array) continue;

            bool stateHasDialogue = false;

            for (auto& action : root.arr)
            {
                if (action.type != JsonValue::Object) continue;
                auto* nameVal = action.Find("Name");
                if (!nameVal || nameVal->str != "ShowTalk") continue;

                auto* paramsVal = action.Find("Params");
                if (!paramsVal || paramsVal->type != JsonValue::Object) continue;

                const JsonValue* talkItemsVal = nullptr;
                for (auto& kv : paramsVal->obj)
                    if (kv.first == "TalkItems") { talkItemsVal = &kv.second; break; }
                if (!talkItemsVal || talkItemsVal->type != JsonValue::Array) continue;

                for (auto& item : talkItemsVal->arr)
                {
                    if (item.type != JsonValue::Object) continue;

                    int whoId = item.GetInt("WhoId", 0);
                    const char* tidTalk = item.GetStr("TidTalk", "");
                    int itemId = item.GetInt("Id", 0);
                    const char* typeStr = item.GetStr("Type", "Talk");

                    std::string speakerNames[NUM_LANGS];
                    GetSpeakerML(whoId, packs, speakerNames);
                    std::string texts[NUM_LANGS];
                    GetTextML(tidTalk, packs, texts);

                    if (!stateHasDialogue)
                    {
                        jw.BeginObject();
                        jw.KV("state_key", entry->stateKey);
                        jw.Key("dialogues");
                        jw.BeginArray();
                        stateHasDialogue = true;
                        hasDialogue = true;
                    }

                    jw.BeginObject();
                    jw.KV("id", itemId);
                    jw.KV("type", typeStr);
                    jw.KV("speaker_id", whoId);
                    for (int i = 0; i < NUM_LANGS; i++) {
                        char key[32]; snprintf(key, sizeof(key), "speaker-%s", LANGUAGES[i].suffix);
                        jw.KV(key, speakerNames[i]);
                    }
                    jw.KV("text_key", tidTalk);
                    for (int i = 0; i < NUM_LANGS; i++) {
                        char key[32]; snprintf(key, sizeof(key), "text-%s", LANGUAGES[i].suffix);
                        jw.KV(key, texts[i]);
                    }

                    auto* optionsArr = item.GetArr("Options");
                    if (optionsArr && !optionsArr->empty()) {
                        jw.Key("options");
                        jw.BeginArray();
                        for (auto& opt : *optionsArr) {
                            const char* optTid = opt.GetStr("TidTalkOption", "");
                            std::string optTexts[NUM_LANGS];
                            GetTextML(optTid, packs, optTexts);
                            jw.BeginObject();
                            jw.KV("text_key", optTid);
                            for (int i = 0; i < NUM_LANGS; i++) {
                                char key[32]; snprintf(key, sizeof(key), "text-%s", LANGUAGES[i].suffix);
                                jw.KV(key, optTexts[i]);
                            }
                            jw.EndObject();
                        }
                        jw.EndArray();
                    }
                    jw.EndObject();
                }
            }

            if (stateHasDialogue)
            {
                jw.EndArray();  // dialogues
                jw.EndObject(); // state
            }
        }

        jw.EndArray();  // states
        jw.EndObject(); // root

        if (!hasDialogue) { skipped++; continue; }

        std::string safeName = SanitizeFileName(group.name);
        // Build path as wide string so _wfopen_s handles UTF-8 Chinese characters correctly
        std::wstring outPathW = outDir + L"\\export_" + Utf8ToWide(safeName) + L".json";

        FILE* f = nullptr;
        _wfopen_s(&f, outPathW.c_str(), L"wb");
        if (f)
        {
            fwrite(jw.Str().c_str(), 1, jw.Str().size(), f);
            fclose(f);
            exported++;
        }

        if (exported % 100 == 0 && exported > 0)
            Log("  ... exported %d flows", exported);
    }

    // Cleanup
    for (int i = 0; i < NUM_LANGS; i++)
        packs[i].Close();

    Log("  Exported %d flows, skipped %d (no dialogue)", exported, skipped);
    Log("===============================================");
    Log("  Dialogue Export Complete!");
    Log("  Output: %ls\\export_dialogue\\", exportDir.c_str());
    Log("===============================================");
}

// ========================================================================
// Quest-Ordered Dialogue Exporter (new generation)
// Mirrors the logic in export_quest_ordered.py:
//   questtreechapter -> questtreenode -> QuestData -> QuestNodeData
//   -> flowState -> ShowTalk -> multilingual text
// Includes Chapter fallback (no tree nodes) and side-quest sweep.
// ========================================================================

// Flow index key: (FlowListName, FlowId)
using FlowKey = std::pair<std::string, int>;

// One entry in the flow index (state in a flow)
struct QFEntry {
    std::string stateKey;
    std::vector<uint8_t> binData;
};

// Quest metadata
struct QuestDataEntry {
    std::string tidName;
    int type = 0;
};

// One player-choice option inside a dialogue line
struct QOOption {
    std::string textKey;    // TidTalkOption
    std::string texts[3];  // multilingual resolved text
};

// One dialogue line extracted from ShowTalk
struct QOLine {
    int id = 0;
    std::string typeStr;
    std::string stateKey;
    std::string textKey;              // TidTalk
    std::string speakerNames[3];     // indexed by NUM_LANGS
    std::string texts[3];
    std::vector<QOOption> options;   // player-choice branches
};

// Flow index: (FlowListName, FlowId) -> sorted state entries
using FlowIndex = std::map<FlowKey, std::vector<QFEntry>>;

// ---- helpers ----

// Extract first JSON blob ({...} or [{...}) from binary data.
// Prefers [{ over { when [{ comes first.
static std::string ExtractFirstJson(const uint8_t* data, int len)
{
    int pos1 = -1, pos2 = -1;
    for (int i = 0; i < len - 1; i++) {
        if (pos2 == -1 && data[i] == '[' && data[i + 1] == '{') pos2 = i;
        if (pos1 == -1 && data[i] == '{') pos1 = i;
        if (pos1 != -1 && pos2 != -1) break;
    }
    if (pos1 == -1 && pos2 == -1) return "";
    int start = (pos2 != -1 && (pos1 == -1 || pos2 <= pos1)) ? pos2 : pos1;
    const char* p = (const char*)(data + start);
    int rem = len - start;
    int end = rem;
    for (int i = 0; i < rem; i++) if (p[i] == '\0') { end = i; break; }
    return std::string(p, end);
}

// Parse "FlowListName_FlowId_StateId" -> extract FlowListName + FlowId
static bool ParseFlowStateKey(const std::string& sk, std::string& listName, int& flowId)
{
    // Find last _digits segment (StateId)
    if (sk.empty()) return false;
    size_t p2 = sk.rfind('_');
    if (p2 == std::string::npos || p2 + 1 >= sk.size()) return false;
    for (size_t i = p2 + 1; i < sk.size(); i++)
        if (!isdigit((unsigned char)sk[i])) return false;
    // Find second-to-last _digits segment (FlowId)
    if (p2 == 0) return false;
    size_t p1 = sk.rfind('_', p2 - 1);
    if (p1 == std::string::npos || p1 + 1 >= p2) return false;
    for (size_t i = p1 + 1; i < p2; i++)
        if (!isdigit((unsigned char)sk[i])) return false;
    flowId   = atoi(sk.c_str() + p1 + 1);
    listName = sk.substr(0, p1);
    return true;
}

// Scan binary data for int32 LE quest IDs in [100M, 400M) present in questDataMap
static std::vector<int> FindQuestIdsInBlob(
    const uint8_t* data, int len,
    const std::unordered_map<int, QuestDataEntry>& validMap)
{
    static const uint32_t DUMMY = 134220800u;
    std::unordered_set<int> found;
    for (int i = 0; i + 3 < len; i++) {
        uint32_t v;
        memcpy(&v, data + i, 4);
        if (v >= 100000000u && v < 400000000u && v != DUMMY) {
            if (validMap.count((int)v)) found.insert((int)v);
        }
    }
    return std::vector<int>(found.begin(), found.end());
}

// Extract last null-terminated token (>= 4 bytes, not a path) -- returns chapter name TID
static std::string ExtractLastStrToken(const uint8_t* data, int len)
{
    std::string last;
    int i = 0;
    while (i < len) {
        int j = i;
        while (j < len && data[j] != 0) j++;
        if (j - i >= 4) {
            std::string s((const char*)data + i, j - i);
            if (s[0] != '/') last = std::move(s);
        }
        i = j + 1;
    }
    return last;
}

// Free-function accessors for JsonObject (JsonValue methods require JsonValue receiver)
static std::string JGet(const JsonObject& obj, const char* k)
{
    for (auto& kv : obj)
        if (kv.first == k && kv.second.type == JsonValue::String) return kv.second.str;
    return "";
}
static int JGetI(const JsonObject& obj, const char* k, int def = 0)
{
    for (auto& kv : obj)
        if (kv.first == k && kv.second.type == JsonValue::Number) return (int)kv.second.num;
    return def;
}
static const JsonObject* JGetObj(const JsonObject& obj, const char* k)
{
    for (auto& kv : obj)
        if (kv.first == k && kv.second.type == JsonValue::Object) return &kv.second.obj;
    return nullptr;
}
static const JsonArray* JGetArr(const JsonObject& obj, const char* k)
{
    for (auto& kv : obj)
        if (kv.first == k && kv.second.type == JsonValue::Array) return &kv.second.arr;
    return nullptr;
}

// Recursively collect (FlowListName, FlowId) pairs from questnodedata JSON
static void CollectFlowPairs(const JsonValue& v, std::set<FlowKey>& out)
{
    if (v.type == JsonValue::Object) {
        const JsonObject& obj = v.obj;
        // Condition form: { "Type":"PlayFlow", "Flow":{ "FlowListName":..., "FlowId":... } }
        if (JGet(obj, "Type") == "PlayFlow") {
            if (auto* flow = JGetObj(obj, "Flow")) {
                std::string fn = JGet(*flow, "FlowListName");
                int fid = JGetI(*flow, "FlowId");
                if (!fn.empty() && fid) out.insert({ fn, fid });
            }
        }
        // Action forms: { "Name":"PlayFlow"|"TriggerFlow"|"ChangeFlowState", "Params":{...} }
        std::string nm = JGet(obj, "Name");
        if (nm == "PlayFlow" || nm == "TriggerFlow" || nm == "ChangeFlowState") {
            if (auto* params = JGetObj(obj, "Params")) {
                // Direct: Params.FlowListName + Params.FlowId
                std::string fn = JGet(*params, "FlowListName");
                int fid = JGetI(*params, "FlowId");
                if (!fn.empty() && fid) out.insert({ fn, fid });
                // Nested: Params.Flow.FlowListName + Params.Flow.FlowId
                if (auto* flow2 = JGetObj(*params, "Flow")) {
                    fn = JGet(*flow2, "FlowListName");
                    fid = JGetI(*flow2, "FlowId");
                    if (!fn.empty() && fid) out.insert({ fn, fid });
                }
            }
        }
        for (auto& kv : obj) CollectFlowPairs(kv.second, out);
    }
    else if (v.type == JsonValue::Array) {
        for (auto& item : v.arr) CollectFlowPairs(item, out);
    }
}

// Query QuestNodeData WHERE Key LIKE 'questId_%' and collect all flow pairs
static std::vector<FlowKey> GetQuestFlowKeys(sqlite3* dbQNode, int questId, JsonParser& jp)
{
    std::set<FlowKey> found;
    char pat[64];
    snprintf(pat, sizeof(pat), "%d_%%", questId);
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(dbQNode,
        "SELECT BinData FROM questnodedata WHERE Key LIKE ? ORDER BY Key",
        -1, &stmt, nullptr) == SQLITE_OK)
    {
        sqlite3_bind_text(stmt, 1, pat, -1, SQLITE_STATIC);
        while (sqlite3_step(stmt) == SQLITE_ROW) {
            const uint8_t* blob = (const uint8_t*)sqlite3_column_blob(stmt, 0);
            int sz = sqlite3_column_bytes(stmt, 0);
            if (!blob || sz <= 0) continue;
            std::string js = ExtractFirstJson(blob, sz);
            if (js.empty()) continue;
            JsonValue root;
            if (jp.Parse(js.c_str(), js.size(), root))
                CollectFlowPairs(root, found);
        }
        sqlite3_finalize(stmt);
    }
    return std::vector<FlowKey>(found.begin(), found.end());
}

// Extract QOLine list from a single flowstate BinData entry
static std::vector<QOLine> ExtractQOLines(
    const std::string& stateKey,
    const uint8_t* blob, int blobLen,
    LangPack packs[/* NUM_LANGS */],
    JsonParser& jp)
{
    std::vector<QOLine> lines;
    std::string json = ExtractFirstJson(blob, blobLen);
    if (json.empty()) return lines;
    // Ensure we start from the array '[' (flowstate BinData can have leading bytes)
    size_t arrPos = json.find('[');
    if (arrPos == std::string::npos) return lines;
    json = json.substr(arrPos);

    JsonValue root;
    if (!jp.Parse(json.c_str(), json.size(), root)) return lines;
    if (root.type != JsonValue::Array) return lines;

    for (auto& action : root.arr) {
        if (action.type != JsonValue::Object) continue;
        if (strcmp(action.GetStr("Name", ""), "ShowTalk") != 0) continue;
        const JsonObject* paramsObj = action.GetObj("Params");
        if (!paramsObj) continue;
        const JsonArray* talkArr = JGetArr(*paramsObj, "TalkItems");
        if (!talkArr) continue;

        for (auto& item : *talkArr) {
            if (item.type != JsonValue::Object) continue;
            int whoId          = item.GetInt("WhoId");
            const char* tidTalk = item.GetStr("TidTalk", "");
            int itemId         = item.GetInt("Id");
            const char* itemTy  = item.GetStr("Type", "Talk");

            QOLine dl;
            dl.id       = itemId;
            dl.typeStr  = itemTy;
            dl.stateKey = stateKey;
            dl.textKey  = tidTalk;
            GetSpeakerML(whoId, packs, dl.speakerNames);
            GetTextML(tidTalk, packs, dl.texts);

            // Collect player-choice options if present
            if (const JsonArray* optsArr = item.GetArr("Options")) {
                for (auto& opt : *optsArr) {
                    if (opt.type != JsonValue::Object) continue;
                    const char* optTid = opt.GetStr("TidTalkOption", "");
                    QOOption qo;
                    qo.textKey = optTid;
                    GetTextML(optTid, packs, qo.texts);
                    dl.options.push_back(std::move(qo));
                }
            }

            lines.push_back(std::move(dl));
        }
    }
    return lines;
}

// Flow group: one (FlowListName, FlowId) bucket with extracted lines
struct QOFlowGroup {
    FlowKey key;
    std::vector<QOLine> lines;
};

// Write a dialogue.json file (Python-compatible format)
static void WriteQOJson(
    const std::wstring& outPath,
    int chapId, const char* chapName,
    int questId, const char* questName,
    const char* flowListFallback,
    const std::vector<QOFlowGroup>& groups)
{
    JsonWriter jw;
    jw.BeginObject();
    if (chapId)                          jw.KV("chapter_id",     chapId);
    if (chapName   && *chapName)         jw.KV("chapter_name",   chapName);
    if (questId)                         jw.KV("quest_id",       questId);
    if (questName  && *questName)        jw.KV("quest_name",     questName);
    if (flowListFallback && *flowListFallback) jw.KV("flow_list_name", flowListFallback);

    jw.Key("languages");
    jw.BeginArray();
    for (int i = 0; i < NUM_LANGS; i++) jw.ValueString(LANGUAGES[i].lang);
    jw.EndArray();

    int total = 0;
    for (auto& g : groups) total += (int)g.lines.size();
    jw.KV("total_lines", total);

    // Emit one line object into jw (used in both "flows" and "all_lines")
    auto EmitLine = [&](const QOLine& dl) {
        jw.BeginObject();
        jw.KV("id",        dl.id);
        jw.KV("type",      dl.typeStr);
        jw.KV("state_key", dl.stateKey);
        jw.KV("text_key",  dl.textKey);
        for (int i = 0; i < NUM_LANGS; i++) {
            char k[48]; snprintf(k, sizeof(k), "speaker_%s", LANGUAGES[i].lang);
            jw.KV(k, dl.speakerNames[i]);
        }
        for (int i = 0; i < NUM_LANGS; i++) {
            char k[48]; snprintf(k, sizeof(k), "text_%s", LANGUAGES[i].lang);
            jw.KV(k, dl.texts[i]);
        }
        if (!dl.options.empty()) {
            jw.Key("options");
            jw.BeginArray();
            for (auto& opt : dl.options) {
                jw.BeginObject();
                jw.KV("text_key", opt.textKey);
                for (int i = 0; i < NUM_LANGS; i++) {
                    char k[48]; snprintf(k, sizeof(k), "text_%s", LANGUAGES[i].lang);
                    jw.KV(k, opt.texts[i]);
                }
                jw.EndObject();
            }
            jw.EndArray();
        }
        jw.EndObject();
    };

    jw.Key("flows");
    jw.BeginArray();
    for (auto& g : groups) {
        if (g.lines.empty()) continue;
        jw.BeginObject();
        jw.KV("flow_list_name", g.key.first);
        jw.KV("flow_id",        g.key.second);
        jw.Key("dialogue");
        jw.BeginArray();
        for (auto& dl : g.lines) EmitLine(dl);
        jw.EndArray();
        jw.EndObject();
    }
    jw.EndArray();

    jw.Key("all_lines");
    jw.BeginArray();
    for (auto& g : groups) for (auto& dl : g.lines) EmitLine(dl);
    jw.EndArray();

    jw.EndObject();

    FILE* f = nullptr;
    _wfopen_s(&f, outPath.c_str(), L"wb");
    if (f) { fwrite(jw.Str().c_str(), 1, jw.Str().size(), f); fclose(f); }
}

// Chinese chapter pattern for fallback (Chapter 4 has no questtreenodes yet)
static const char* ChapterZhPattern(int id)
{
    // UTF-8 encodings: 第 = E7 AC AC, 一=E4B880 二=E4BA8C 三=E4B889 四=E59B9B 五=E4BA94 六=E585AD 章=E7AB A0
    static const char* tbl[] = { "", "\xe7\xac\xac\xe4\xb8\x80\xe7\xab\xa0",  // 第一章
                                      "\xe7\xac\xac\xe4\xba\x8c\xe7\xab\xa0",  // 第二章
                                      "\xe7\xac\xac\xe4\xb8\x89\xe7\xab\xa0",  // 第三章
                                      "\xe7\xac\xac\xe5\x9b\x9b\xe7\xab\xa0",  // 第四章
                                      "\xe7\xac\xac\xe4\xba\x94\xe7\xab\xa0",  // 第五章
                                      "\xe7\xac\xac\xe5\x85\xad\xe7\xab\xa0" };// 第六章
    return (id >= 0 && id <= 6) ? tbl[id] : "";
}

static void ExportQuestOrderedFlows()
{
    std::wstring exportDir = GetOutputDir();
    std::wstring baseDir   = exportDir + L"\\base";

    Log("===============================================");
    Log("  Quest-Ordered Dialogue Export (New Gen)");
    Log("===============================================");

    auto FileExists = [](const std::wstring& p) {
        return GetFileAttributesW(p.c_str()) != INVALID_FILE_ATTRIBUTES;
    };
    if (!FileExists(baseDir + L"\\db_flowState.db")) {
        Log("ERROR: base\\db_flowState.db not found. Run ConfigDB export first!");
        return;
    }

    // ---- Open source databases ----
    auto OpenRO = [&](const wchar_t* name) -> sqlite3* {
        std::string utf8 = WToUtf8(baseDir + L"\\" + name);
        sqlite3* db = nullptr;
        if (sqlite3_open_v2(utf8.c_str(), &db, SQLITE_OPEN_READONLY, nullptr) != SQLITE_OK) {
            Log("  WARN: Cannot open %ls", name);
            return nullptr;
        }
        return db;
    };

    sqlite3* dbTree  = OpenRO(L"db_QuestTree.db");
    sqlite3* dbQData = OpenRO(L"db_QuestData.db");
    sqlite3* dbQNode = OpenRO(L"db_QuestNodeData.db");
    sqlite3* dbFS    = OpenRO(L"db_flowState.db");

    if (!dbTree || !dbQData || !dbQNode || !dbFS) {
        Log("ERROR: Cannot open one or more required databases.");
        if (dbTree)  sqlite3_close(dbTree);
        if (dbQData) sqlite3_close(dbQData);
        if (dbQNode) sqlite3_close(dbQNode);
        if (dbFS)    sqlite3_close(dbFS);
        return;
    }

    // ---- Speaker map + language packs ----
    g_speakerMap.clear();
    LoadSpeakerMap(baseDir);

    LangPack packs[NUM_LANGS];
    for (int i = 0; i < NUM_LANGS; i++) {
        std::wstring langDir = exportDir + L"\\" + Utf8ToWide(LANGUAGES[i].lang);
        if (!packs[i].Open(langDir, LANGUAGES[i].suffix))
            Log("  WARNING: Some lang DBs missing for '%s'", LANGUAGES[i].lang);
    }

    // ---- Load questtreechapter ----
    struct ChRow { int id; std::vector<uint8_t> bin; };
    std::vector<ChRow> chapters;
    {
        sqlite3_stmt* st = nullptr;
        if (sqlite3_prepare_v2(dbTree,
            "SELECT Id, BinData FROM questtreechapter ORDER BY Id",
            -1, &st, nullptr) == SQLITE_OK) {
            while (sqlite3_step(st) == SQLITE_ROW) {
                ChRow r;
                r.id = sqlite3_column_int(st, 0);
                const uint8_t* b = (const uint8_t*)sqlite3_column_blob(st, 1);
                int sz = sqlite3_column_bytes(st, 1);
                if (b && sz > 0) r.bin.assign(b, b + sz);
                chapters.push_back(std::move(r));
            }
            sqlite3_finalize(st);
        }
    }
    Log("  Chapters: %d", (int)chapters.size());

    // ---- Load questtreenode ----
    struct NodeRow { int id, chapterId; std::vector<uint8_t> bin; };
    std::vector<NodeRow> allNodes;
    {
        sqlite3_stmt* st = nullptr;
        if (sqlite3_prepare_v2(dbTree,
            "SELECT Id, ChapterId, BinData FROM questtreenode ORDER BY ChapterId, Id",
            -1, &st, nullptr) == SQLITE_OK) {
            while (sqlite3_step(st) == SQLITE_ROW) {
                NodeRow r;
                r.id        = sqlite3_column_int(st, 0);
                r.chapterId = sqlite3_column_int(st, 1);
                const uint8_t* b = (const uint8_t*)sqlite3_column_blob(st, 2);
                int sz = sqlite3_column_bytes(st, 2);
                if (b && sz > 0) r.bin.assign(b, b + sz);
                allNodes.push_back(std::move(r));
            }
            sqlite3_finalize(st);
        }
    }
    Log("  Tree nodes: %d", (int)allNodes.size());

    // ---- Load questdata ----
    std::unordered_map<int, QuestDataEntry> questDataMap;
    {
        JsonParser jp0;
        sqlite3_stmt* st = nullptr;
        if (sqlite3_prepare_v2(dbQData,
            "SELECT QuestId, BinData FROM questdata",
            -1, &st, nullptr) == SQLITE_OK) {
            while (sqlite3_step(st) == SQLITE_ROW) {
                int qid = sqlite3_column_int(st, 0);
                const uint8_t* b = (const uint8_t*)sqlite3_column_blob(st, 1);
                int sz = sqlite3_column_bytes(st, 1);
                if (!b || sz <= 0) continue;
                std::string js = ExtractFirstJson(b, sz);
                if (js.empty()) continue;
                JsonValue root;
                if (!jp0.Parse(js.c_str(), js.size(), root)) continue;
                if (root.type != JsonValue::Object) continue;
                QuestDataEntry e;
                e.tidName = root.GetStr("TidName",  "");
                e.type    = root.GetInt("Type", 0);
                questDataMap[qid] = std::move(e);
            }
            sqlite3_finalize(st);
        }
    }
    Log("  Quest entries: %d", (int)questDataMap.size());

    // ---- Load + index flowState ----
    FlowIndex flowIndex;
    {
        sqlite3_stmt* st = nullptr;
        if (sqlite3_prepare_v2(dbFS,
            "SELECT StateKey, BinData FROM flowstate ORDER BY StateKey",
            -1, &st, nullptr) == SQLITE_OK) {
            while (sqlite3_step(st) == SQLITE_ROW) {
                const char* sk = (const char*)sqlite3_column_text(st, 0);
                if (!sk) continue;
                std::string stateKey(sk);
                const uint8_t* b = (const uint8_t*)sqlite3_column_blob(st, 1);
                int sz = sqlite3_column_bytes(st, 1);
                std::string listName; int flowId = 0;
                if (!ParseFlowStateKey(stateKey, listName, flowId)) continue;
                QFEntry e;
                e.stateKey = stateKey;
                if (b && sz > 0) e.binData.assign(b, b + sz);
                flowIndex[{ listName, flowId }].push_back(std::move(e));
            }
            sqlite3_finalize(st);
        }
    }
    Log("  Flow index: %d combinations", (int)flowIndex.size());

    // ---- Output dir (clean stale files from prior runs first) ----
    std::wstring outDir = exportDir + L"\\export_quest_ordered";
    if (GetFileAttributesW(outDir.c_str()) != INVALID_FILE_ATTRIBUTES)
    {
        Log("  Cleaning stale output dir: %ls", outDir.c_str());
        DeleteDirRecursive(outDir);
    }
    CreateDirRecursive(outDir);
    Log("  Output: %ls", outDir.c_str());

    // Shared JSON parser (Parse() resets state each call)
    JsonParser jp;

    // Helper: gather lines from a list of flow keys, write dialogue.json, return total lines
    auto CollectAndWrite = [&](
        const std::vector<FlowKey>& flowKeys,
        int chapId, const char* chapName,
        int questId, const char* questName,
        const char* flowListFallback,
        const std::wstring& destDir,
        const std::string& fileName) -> int
    {
        std::vector<QOFlowGroup> groups;
        int total = 0;
        for (auto& fk : flowKeys) {
            auto it = flowIndex.find(fk);
            if (it == flowIndex.end()) continue;
            QOFlowGroup grp;
            grp.key = fk;
            for (auto& e : it->second) {
                if (e.binData.empty()) continue;
                auto lns = ExtractQOLines(e.stateKey,
                    e.binData.data(), (int)e.binData.size(), packs, jp);
                for (auto& l : lns) grp.lines.push_back(std::move(l));
            }
            total += (int)grp.lines.size();
            groups.push_back(std::move(grp));
        }
        if (total == 0) return 0;
        CreateDirRecursive(destDir);
        std::wstring fp = destDir + L"\\" + Utf8ToWide(fileName);
        WriteQOJson(fp, chapId, chapName, questId, questName, flowListFallback, groups);
        return total;
    };

    std::set<int> covered;
    int mainLines = 0;

    // ================================================================
    // Chapter loop
    // ================================================================
    for (auto& ch : chapters) {
        std::string chNameTid = ch.bin.empty() ? ""
            : ExtractLastStrToken(ch.bin.data(), (int)ch.bin.size());
        std::string chName = chNameTid.empty() ? "" : packs[ZH_IDX].GetText(chNameTid);
        if (chName.empty()) chName = chNameTid.empty()
            ? ("Chapter_" + std::to_string(ch.id)) : chNameTid;

        Log("  ---- Chapter %d: %s ----", ch.id, chName.c_str());

        std::wstring chDir = outDir + L"\\" +
            Utf8ToWide(SanitizeFileName("Chapter_" + std::to_string(ch.id) + "_" + chName));

        // Collect nodes for this chapter (already ordered by Id from SQL)
        std::vector<const NodeRow*> chNodes;
        for (auto& n : allNodes) if (n.chapterId == ch.id) chNodes.push_back(&n);

        int questIdx = 0;

        // ---- Normal path: iterate tree nodes ----
        for (auto* node : chNodes) {
            if (node->bin.empty()) continue;
            std::vector<int> qids = FindQuestIdsInBlob(
                node->bin.data(), (int)node->bin.size(), questDataMap);
            std::sort(qids.begin(), qids.end());

            for (int qid : qids) {
                if (covered.count(qid)) continue;
                covered.insert(qid);

                auto& qe = questDataMap[qid];
                std::string qName = qe.tidName.empty() ? ""
                    : packs[ZH_IDX].GetText(qe.tidName);
                if (qName.empty()) qName = "Quest_" + std::to_string(qid);

                auto flowKeys = GetQuestFlowKeys(dbQNode, qid, jp);
                int lines = 0;
                if (!flowKeys.empty()) {
                    questIdx++;
                    char fb[256];
                    snprintf(fb, sizeof(fb), "%03d_%s", questIdx, qName.c_str());
                    std::wstring qDir = chDir + L"\\" + Utf8ToWide(SanitizeFileName(fb));
                    lines = CollectAndWrite(flowKeys,
                        ch.id, chName.c_str(), qid, qName.c_str(), nullptr,
                        qDir, "dialogue.json");
                    mainLines += lines;
                }
                Log("    [%03d] Quest %d: %s  (flows:%d lines:%d)",
                    questIdx, qid, qName.c_str(), (int)flowKeys.size(), lines);
            }
        }

        // ---- Fallback: chapter has no tree nodes (e.g. Chapter 4) ----
        // Scan flow list names for the Chinese chapter pattern.
        if (chNodes.empty()) {
            const char* pattern = ChapterZhPattern(ch.id);
            Log("    No tree nodes -- scanning flow names for '%s'", pattern);

            if (pattern[0] != '\0') {
                std::map<std::string, std::vector<int>> chFlows;
                for (auto& kv : flowIndex)
                    if (kv.first.first.find(pattern) != std::string::npos)
                        chFlows[kv.first.first].push_back(kv.first.second);

                // UTF-8 bytes for "剧情_" prefix to strip (7 bytes)
                static const char JUQING_PFX[] = "\xe5\x89\xa7\xe6\x83\x85_";
                for (auto& cf : chFlows) {
                    std::vector<FlowKey> fks;
                    for (int fid : cf.second) fks.push_back({ cf.first, fid });
                    std::sort(fks.begin(), fks.end());

                    questIdx++;
                    std::string safeName = cf.first;
                    if (safeName.substr(0, 7) == JUQING_PFX) safeName = safeName.substr(7);
                    char fb[256];
                    snprintf(fb, sizeof(fb), "%03d_%s", questIdx, safeName.c_str());
                    std::wstring qDir = chDir + L"\\" + Utf8ToWide(SanitizeFileName(fb));
                    int lines = CollectAndWrite(fks,
                        ch.id, chName.c_str(), 0, nullptr, cf.first.c_str(),
                        qDir, "dialogue.json");
                    mainLines += lines;
                    Log("    [%03d] Flow '%s': %d lines", questIdx, cf.first.c_str(), lines);
                }
            }
        }
    }

    // ================================================================
    // Side quests: all quests NOT covered by the main story tree
    // ================================================================
    Log("  Collecting side quests...");
    std::wstring sideDir = outDir + L"\\side_quests";
    int sideCount = 0;

    for (auto& kv : questDataMap) {
        int qid = kv.first;
        if (covered.count(qid)) continue;

        auto flowKeys = GetQuestFlowKeys(dbQNode, qid, jp);
        if (flowKeys.empty()) continue;

        std::string qName = kv.second.tidName.empty() ? ""
            : packs[ZH_IDX].GetText(kv.second.tidName);
        if (qName.empty()) qName = "Quest_" + std::to_string(qid);

        char fb[256];
        snprintf(fb, sizeof(fb), "%d_%s", qid, qName.c_str());
        std::wstring qDir = sideDir + L"\\" + Utf8ToWide(SanitizeFileName(fb));
        int lines = CollectAndWrite(flowKeys, 0, nullptr, qid, qName.c_str(), nullptr,
                                    qDir, "dialogue.json");
        if (lines > 0) sideCount++;
    }

    // ---- Cleanup ----
    sqlite3_close(dbTree);
    sqlite3_close(dbQData);
    sqlite3_close(dbQNode);
    sqlite3_close(dbFS);
    for (int i = 0; i < NUM_LANGS; i++) packs[i].Close();

    Log("===============================================");
    Log("  Quest-Ordered Export Complete!");
    Log("  Main story lines : %d", mainLines);
    Log("  Side quests      : %d", sideCount);
    Log("  Output: %ls", outDir.c_str());
    Log("===============================================");
}

// ========================================================================
// VFS Tree Structure Mapping (tree command format)
// ========================================================================
struct VFSNode {
    std::wstring name;
    bool isDirectory = false;
    std::map<std::wstring, VFSNode> children;
};

static void InsertVFSPathComponent(VFSNode& parent, const std::vector<std::wstring>& components, size_t index, bool isDir)
{
    if (index >= components.size()) return;
    const auto& name = components[index];
    auto it = parent.children.find(name);
    if (it == parent.children.end())
    {
        VFSNode child;
        child.name = name;
        child.isDirectory = (index < components.size() - 1) ? true : isDir;
        parent.children[name] = child;
        InsertVFSPathComponent(parent.children[name], components, index + 1, isDir);
    }
    else
    {
        if (index == components.size() - 1 && isDir)
            it->second.isDirectory = true;
        InsertVFSPathComponent(it->second, components, index + 1, isDir);
    }
}

static void BuildTreeString(const VFSNode& node, const std::wstring& prefix, bool isLast, std::string& out)
{
    if (!node.name.empty())
    {
        std::string utf8Name = WToUtf8(node.name);
        out += WToUtf8(prefix);
        out += isLast ? "└── " : "├── ";
        out += utf8Name;
        if (node.isDirectory) out += "/";
        out += "\n";
    }

    std::wstring newPrefix = prefix;
    if (!node.name.empty())
    {
        newPrefix += isLast ? L"    " : L"│   ";
    }

    size_t i = 0;
    for (const auto& pair : node.children)
    {
        bool lastChild = (i == node.children.size() - 1);
        BuildTreeString(pair.second, newPrefix, lastChild, out);
        i++;
    }
}

static std::vector<std::wstring> SplitPath(const std::wstring& path)
{
    std::vector<std::wstring> result;
    std::wstring current;
    for (wchar_t c : path)
    {
        if (c == L'/' || c == L'\\')
        {
            if (!current.empty())
            {
                result.push_back(current);
                current.clear();
            }
        }
        else
        {
            current += c;
        }
    }
    if (!current.empty())
    {
        result.push_back(current);
    }
    return result;
}

static void ExportVFSTree()
{
    std::wstring exportDir = GetOutputDir();
    CreateDirRecursive(exportDir);

    Log("===============================================");
    Log("  VFS Tree Structure Mapping");
    Log("===============================================");

    // Get virtual content directory
    FString contentDirFS = UKismetSystemLibrary::GetProjectContentDirectory();
    std::wstring contentDir = contentDirFS.ToWString();
    Log("Content virtual root: %ls", contentDir.c_str());

    Log("Scanning VFS recursively... (this may take a moment)");
    TArray<FString> allPaths = UKuroStaticLibrary::GetFilesRecursive(contentDirFS, FString(L""), true, true);
    Log("Scan complete. Found %d VFS items", allPaths.Num());

    if (allPaths.Num() == 0)
    {
        Log("ERROR: VFS scan returned no items!");
        return;
    }

    VFSNode root;
    root.name = L"Content";
    root.isDirectory = true;

    int filesCount = 0;
    int dirsCount = 0;

    for (int32 i = 0; i < allPaths.Num(); i++)
    {
        std::wstring rawPath = allPaths[i].ToWString();
        // Remove virtual content root prefix if present
        if (rawPath.find(contentDir) == 0)
        {
            rawPath = rawPath.substr(contentDir.length());
        }
        // Normalize path separators
        for (auto& c : rawPath) if (c == L'/') c = L'\\';
        
        // Remove leading backslashes
        while (!rawPath.empty() && rawPath.front() == L'\\')
        {
            rawPath = rawPath.substr(1);
        }
        // Remove trailing backslashes
        while (!rawPath.empty() && rawPath.back() == L'\\')
        {
            rawPath.pop_back();
        }

        if (rawPath.empty()) continue;

        std::wstring fullPath = contentDir + rawPath;
        FString fFullPath(fullPath.c_str());
        bool isDir = UKuroStaticLibrary::DirectoryExists(fFullPath);
        if (isDir) dirsCount++;
        else filesCount++;

        auto components = SplitPath(rawPath);
        if (!components.empty())
        {
            InsertVFSPathComponent(root, components, 0, isDir);
        }

        if (i % 1000 == 0 && i > 0)
        {
            Log("  ... processed %d/%d items", i, allPaths.Num());
        }
    }

    Log("Building tree layout...");
    std::string treeStr;
    treeStr = "Wuthering Waves VFS Tree Mapping\n";
    treeStr += "Root: " + WToUtf8(contentDir) + "\n";
    treeStr += "Items scanned: " + std::to_string(filesCount) + " files, " + std::to_string(dirsCount) + " directories\n";
    treeStr += "========================================================================\n\n";

    BuildTreeString(root, L"", true, treeStr);

    std::wstring outPath = exportDir + L"\\vfs_tree.txt";
    FILE* f = nullptr;
    _wfopen_s(&f, outPath.c_str(), L"wb");
    if (f)
    {
        fwrite(treeStr.c_str(), 1, treeStr.size(), f);
        fclose(f);
        Log("SUCCESS: Tree saved to %ls", outPath.c_str());
    }
    else
    {
        Log("ERROR: Cannot create output file %ls", outPath.c_str());
    }
    Log("===============================================");
}

// ========================================================================
// Worker thread
// ========================================================================
static DWORD WINAPI WorkerThread(LPVOID)
{
    AllocConsole();
    SetConsoleTitleW(L"WuwaVH - Wuthering Waves Export Toolkit");
    SetConsoleOutputCP(CP_UTF8);

    FILE* fOut = nullptr;
    FILE* fErr = nullptr;
    FILE* fIn  = nullptr;
    freopen_s(&fOut, "CONOUT$", "w", stdout);
    freopen_s(&fErr, "CONOUT$", "w", stderr);
    freopen_s(&fIn,  "CONIN$",  "r", stdin);

    HWND consoleWnd = GetConsoleWindow();
    if (consoleWnd)
    {
        ShowWindow(consoleWnd, SW_SHOW);
        SetForegroundWindow(consoleWnd);
    }

    printf("[WuwaVH] DLL loaded. Resolving SDK offsets dynamically...\n");

    if (!InitializeSDK(120))
    {
        printf("[WuwaVH] ERROR: Failed to resolve SDK offsets (120s timeout)\n");
        MessageBoxW(NULL, L"Failed to resolve SDK offsets.\nPattern scanning could not find GObjects.\nMake sure the game is running.",
                    L"WuwaVH Error", MB_OK | MB_ICONERROR);
        FreeConsole();
        return 1;
    }

    printf("[WuwaVH] SDK initialized with dynamic offsets.\n\n");
    printf("  ==========================================\n");
    printf("  [1] Export ConfigDB + Dialogue Flows (flat)\n");
    printf("  [2] Export ConfigDB only\n");
    printf("  [3] Quest-Ordered Dialogue Export (new gen)\n");
    printf("  [4] Full: ConfigDB + Quest-Ordered Export\n");
    printf("  [5] Map VFS Tree Structure\n");
    printf("  [0] Exit\n");
    printf("  ==========================================\n");
    printf("  Choice: ");

    int choice = 0;
    scanf_s("%d", &choice);

    switch (choice)
    {
    case 1:
        printf("\n[WuwaVH] Starting full export (ConfigDB + flat dialogue)...\n");
        ExportAllDatabases();
        ExportDialogueFlows();
        printf("\n[WuwaVH] Full export complete! Output: Desktop\\WuwaDBExport\\\n");
        MessageBoxW(NULL, L"Full export (ConfigDB + flat dialogue) complete!\nOutput: Desktop\\WuwaDBExport\\",
                    L"WuwaVH", MB_OK | MB_ICONINFORMATION);
        break;

    case 2:
        printf("\n[WuwaVH] Starting ConfigDB export...\n");
        ExportAllDatabases();
        printf("\n[WuwaVH] ConfigDB export complete! Output: Desktop\\WuwaDBExport\\\n");
        MessageBoxW(NULL, L"ConfigDB export complete!\nOutput: Desktop\\WuwaDBExport\\",
                    L"WuwaVH", MB_OK | MB_ICONINFORMATION);
        break;

    case 3:
        printf("\n[WuwaVH] Starting quest-ordered dialogue export (new gen)...\n");
        printf("[WuwaVH] NOTE: Requires prior ConfigDB export (option 2 or 4).\n");
        ExportQuestOrderedFlows();
        printf("\n[WuwaVH] Quest-ordered export complete! Output: Desktop\\WuwaDBExport\\export_quest_ordered\\\n");
        MessageBoxW(NULL,
            L"Quest-Ordered Dialogue Export complete!\nOutput: Desktop\\WuwaDBExport\\export_quest_ordered\\",
            L"WuwaVH", MB_OK | MB_ICONINFORMATION);
        break;

    case 4:
        printf("\n[WuwaVH] Starting full export (ConfigDB + quest-ordered dialogue)...\n");
        ExportAllDatabases();
        ExportQuestOrderedFlows();
        printf("\n[WuwaVH] Full quest-ordered export complete! Output: Desktop\\WuwaDBExport\\\n");
        MessageBoxW(NULL,
            L"Full Export (ConfigDB + Quest-Ordered Dialogue) complete!\nOutput: Desktop\\WuwaDBExport\\",
            L"WuwaVH", MB_OK | MB_ICONINFORMATION);
        break;

    case 5:
        printf("\n[WuwaVH] Starting VFS tree mapping...\n");
        ExportVFSTree();
        printf("\n[WuwaVH] VFS tree mapping complete! Output: Desktop\\WuwaDBExport\\vfs_tree.txt\n");
        MessageBoxW(NULL,
            L"VFS Tree Mapping complete!\nOutput: Desktop\\WuwaDBExport\\vfs_tree.txt",
            L"WuwaVH", MB_OK | MB_ICONINFORMATION);
        break;

    default:
        printf("\n[WuwaVH] Exiting.\n");
        break;
    }

    printf("[WuwaVH] Press Enter to close console...\n");
    getchar(); getchar();

    if (fOut) fclose(fOut);
    if (fErr) fclose(fErr);
    if (fIn)  fclose(fIn);
    FreeConsole();

    return 0;
}

// ========================================================================
// DLL Entry Point
// ========================================================================
BOOL APIENTRY DllMain(HMODULE hModule, DWORD ul_reason_for_call, LPVOID lpReserved)
{
    switch (ul_reason_for_call)
    {
    case DLL_PROCESS_ATTACH:
        DisableThreadLibraryCalls(hModule);
        CreateThread(NULL, 0, WorkerThread, NULL, 0, NULL);
        break;
    case DLL_THREAD_ATTACH:
    case DLL_THREAD_DETACH:
    case DLL_PROCESS_DETACH:
        break;
    }
    return TRUE;
}

