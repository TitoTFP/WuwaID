#pragma once
// DynamicResolver.hpp - Runtime SDK offset resolution via pattern scanning
// Finds GObjects, FNamePool, FName::AppendString fallback, and ProcessEvent
// VTable index dynamically.
// so the DLL survives game patches without recompilation.
//
// Uses the same strategies as Dumper-7:
//   GObjects:        structural validation in .data section
//   FNamePool:       constructor reference + validated pool/name entries
//   AppendString:    string XREF "ForwardShadingQuality_" -> nearby CALL target
//   ProcessEventIdx: VTable scan for TEST FunctionFlags with 0x400 and 0x4000

#include <windows.h>
#include <cstdint>
#include <cstdio>
#include <vector>
#include <functional>

namespace DynamicResolver
{

struct ResolvedOffsets
{
    uintptr_t GObjects      = 0;   // Absolute address of TUObjectArray
    uintptr_t AppendString  = 0;   // Absolute address of FName::AppendString
    int32_t   ProcessEventIdx = -1; // VTable index for ProcessEvent
};

// ========================================================================
// Pattern scanning primitives
// ========================================================================

struct PatternByte { uint8_t value; bool wildcard; };

static std::vector<PatternByte> ParsePattern(const char* pat)
{
    std::vector<PatternByte> result;
    while (*pat)
    {
        while (*pat == ' ') pat++;
        if (!*pat) break;
        if (*pat == '?')
        {
            result.push_back({ 0, true });
            while (*pat == '?') pat++;
        }
        else
        {
            char h[3] = { pat[0], pat[1], 0 };
            result.push_back({ (uint8_t)strtoul(h, nullptr, 16), false });
            pat += 2;
        }
    }
    return result;
}

static uintptr_t ScanRegion(uintptr_t start, size_t size, const std::vector<PatternByte>& pat)
{
    if (pat.empty() || size < pat.size()) return 0;
    for (size_t i = 0; i <= size - pat.size(); i++)
    {
        bool ok = true;
        for (size_t j = 0; j < pat.size(); j++)
        {
            if (!pat[j].wildcard && *(uint8_t*)(start + i + j) != pat[j].value)
            {
                ok = false;
                break;
            }
        }
        if (ok) return start + i;
    }
    return 0;
}

// ========================================================================
// PE helpers
// ========================================================================

struct Section { uintptr_t base; size_t size; };

static bool GetModuleRange(uintptr_t& base, size_t& size)
{
    auto* m = (uint8_t*)GetModuleHandleA(nullptr);
    if (!m) return false;
    auto* nt = (IMAGE_NT_HEADERS*)(m + ((IMAGE_DOS_HEADER*)m)->e_lfanew);
    base = (uintptr_t)m;
    size = nt->OptionalHeader.SizeOfImage;
    return true;
}

static Section GetSection(const char* name)
{
    auto* m = (uint8_t*)GetModuleHandleA(nullptr);
    if (!m) return { 0, 0 };
    auto* nt = (IMAGE_NT_HEADERS*)(m + ((IMAGE_DOS_HEADER*)m)->e_lfanew);
    auto* sect = IMAGE_FIRST_SECTION(nt);
    size_t nameLen = strlen(name);

    // Recent game builds use an obfuscator that renames every PE section to
    // the same value (currently ".std"). Resolve conventional SDK sections
    // from their memory flags as a fallback.
    Section semanticMatch{ 0, 0 };
    for (int i = 0; i < nt->FileHeader.NumberOfSections; i++)
    {
        const auto characteristics = sect[i].Characteristics;
        const bool nameMatch = memcmp(sect[i].Name, name, nameLen) == 0;
        if (nameMatch)
            return { (uintptr_t)m + sect[i].VirtualAddress, sect[i].Misc.VirtualSize };

        const bool isExecutable =
            (characteristics & IMAGE_SCN_MEM_EXECUTE) != 0;
        const bool isWritable =
            (characteristics & IMAGE_SCN_MEM_WRITE) != 0;
        const bool isReadable =
            (characteristics & IMAGE_SCN_MEM_READ) != 0;

        if (strcmp(name, ".text") == 0 && isExecutable && isReadable)
        {
            if (!semanticMatch.base)
                semanticMatch = { (uintptr_t)m + sect[i].VirtualAddress,
                                   sect[i].Misc.VirtualSize };
        }
        else if (strcmp(name, ".data") == 0 && isWritable && isReadable &&
                 !isExecutable)
        {
            if (!semanticMatch.base)
                semanticMatch = { (uintptr_t)m + sect[i].VirtualAddress,
                                   sect[i].Misc.VirtualSize };
        }
    }
    return semanticMatch;
}

// ========================================================================
// GObjects finder — structural validation in .data section
// ========================================================================
// TUObjectArray layout (0x20 bytes):
//   +0x00: FUObjectItem** Objects
//   +0x08: pad[8]
//   +0x10: int32 MaxElements
//   +0x14: int32 NumElements
//   +0x18: int32 MaxChunks
//   +0x1C: int32 NumChunks
// FUObjectItem = 0x18 bytes: { UObject* (8), pad (0x10) }
// UObject:  { VTable @0x00, Flags @0x08, Index @0x0C, ... }

static uintptr_t FindGObjects(void (*log)(const char*, ...) = nullptr)
{
    auto data = GetSection(".data");
    if (!data.base || !data.size)
    {
        if (log) log("  [Resolver] .data section not found");
        return 0;
    }

    for (uintptr_t addr = data.base; addr + 0x20 <= data.base + data.size; addr += 4)
    {
        __try
        {
            auto objectsPtr = *(uintptr_t*)(addr + 0x00);
            auto maxElem    = *(int32_t*)(addr + 0x10);
            auto numElem    = *(int32_t*)(addr + 0x14);
            auto maxChunks  = *(int32_t*)(addr + 0x18);
            auto numChunks  = *(int32_t*)(addr + 0x1C);

            // Basic sanity
            if (numElem < 0x1000 || numElem > maxElem) continue;
            if (maxElem > 0x400000) continue;
            if (numChunks <= 0 || maxChunks < numChunks || maxChunks > 0x10000) continue;
            if (objectsPtr < 0x10000 || objectsPtr > 0x00007FFFFFFFFFFF) continue;

            auto** chunks = (void**)objectsPtr;
            if (!chunks[0]) continue;

            // Validate objects at indices 1..5 have matching InternalIndex
            bool valid = true;
            for (int k = 1; k <= 5; k++)
            {
                auto* item = (uint8_t*)chunks[0] + (uintptr_t)k * 0x18;
                auto obj = *(uintptr_t*)item;
                if (!obj || obj < 0x10000) { valid = false; break; }
                if (*(int32_t*)(obj + 0x0C) != k) { valid = false; break; }
            }
            if (!valid) continue;

            if (log) log("  [Resolver] GObjects found at 0x%p (%d objects, %d chunks)",
                (void*)addr, numElem, numChunks);
            return addr;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) { continue; }
    }

    if (log) log("  [Resolver] GObjects NOT FOUND in .data section");
    return 0;
}

// ========================================================================
// String XREF helpers — find LEA rip-relative instructions pointing to strings
// ========================================================================

// Iterate all readable sections in the module
static void IterateReadableSections(
    const std::function<bool(uintptr_t secBase, size_t secSize, bool isExecutable)>& callback)
{
    auto* m = (uint8_t*)GetModuleHandleA(nullptr);
    if (!m) return;
    auto* nt = (IMAGE_NT_HEADERS*)(m + ((IMAGE_DOS_HEADER*)m)->e_lfanew);
    auto* sect = IMAGE_FIRST_SECTION(nt);
    for (int i = 0; i < nt->FileHeader.NumberOfSections; i++)
    {
        if (!(sect[i].Characteristics & IMAGE_SCN_MEM_READ)) continue;
        uintptr_t base = (uintptr_t)m + sect[i].VirtualAddress;
        size_t size = sect[i].Misc.VirtualSize;
        bool isExe = !!(sect[i].Characteristics & IMAGE_SCN_MEM_EXECUTE);
        if (callback(base, size, isExe))
            return;
    }
}

// Recent builds split executable code across multiple sections. Do not treat
// the first executable section as the complete code range when resolving CALLs.
static bool IsAddressInExecutableSection(uintptr_t address)
{
    bool found = false;
    IterateReadableSections([&](uintptr_t secBase, size_t secSize, bool isExecutable) -> bool
    {
        if (isExecutable && address >= secBase && address < secBase + secSize)
        {
            found = true;
            return true;
        }
        return false;
    });
    return found;
}

// Find a LEA rip-relative instruction pointing to a given ANSI string (searches all readable sections)
static uintptr_t FindAnsiStringXRef(const char* target, void (*log)(const char*, ...) = nullptr)
{
    size_t targetLen = strlen(target);
    uintptr_t modBase, modSize;
    if (!GetModuleRange(modBase, modSize)) return 0;

    uintptr_t result = 0;
    IterateReadableSections([&](uintptr_t secBase, size_t secSize, bool /*isExe*/) -> bool
    {
        if (secSize < 7) return false;
        for (size_t off = 0; off + 7 <= secSize; off++)
        {
            uintptr_t a = secBase + off;
            auto* p = (uint8_t*)a;
            // LEA reg, [rip+disp32]:  48/4C 8D [ModRM with mod=00 rm=101]
            if ((p[0] == 0x48 || p[0] == 0x4C) && p[1] == 0x8D && (p[2] & 0xC7) == 0x05)
            {
                auto disp = *(int32_t*)(a + 3);
                auto strAddr = a + 7 + disp;
                if (strAddr >= modBase && strAddr + targetLen < modBase + modSize)
                {
                    __try
                    {
                        if (memcmp((void*)strAddr, target, targetLen + 1) == 0)
                        {
                            result = a;
                            return true;
                        }
                    }
                    __except (EXCEPTION_EXECUTE_HANDLER) {}
                }
            }
        }
        return false;
    });
    return result;
}

// Find a LEA rip-relative instruction pointing to a given WIDE string (searches all readable sections)
static uintptr_t FindWideStringXRef(const wchar_t* target, void (*log)(const char*, ...) = nullptr)
{
    size_t targetLen = wcslen(target);
    size_t targetBytes = (targetLen + 1) * sizeof(wchar_t);
    uintptr_t modBase, modSize;
    if (!GetModuleRange(modBase, modSize)) return 0;

    uintptr_t result = 0;
    IterateReadableSections([&](uintptr_t secBase, size_t secSize, bool /*isExe*/) -> bool
    {
        if (secSize < 7) return false;
        for (size_t off = 0; off + 7 <= secSize; off++)
        {
            uintptr_t a = secBase + off;
            auto* p = (uint8_t*)a;
            if ((p[0] == 0x48 || p[0] == 0x4C) && p[1] == 0x8D && (p[2] & 0xC7) == 0x05)
            {
                auto disp = *(int32_t*)(a + 3);
                auto strAddr = a + 7 + disp;
                if (strAddr >= modBase && strAddr + targetBytes < modBase + modSize)
                {
                    __try
                    {
                        if (memcmp((void*)strAddr, target, targetBytes) == 0)
                        {
                            result = a;
                            return true;
                        }
                    }
                    __except (EXCEPTION_EXECUTE_HANDLER) {}
                }
            }
        }
        return false;
    });
    return result;
}

// Resolve E8 CALL: returns absolute target address or 0
static uintptr_t ResolveE8Call(uintptr_t callAddr)
{
    if (*(uint8_t*)callAddr != 0xE8) return 0;
    auto rel = *(int32_t*)(callAddr + 1);
    auto target = callAddr + 5 + rel;
    if (IsAddressInExecutableSection(target))
        return target;
    return 0;
}

// ========================================================================
// AppendString finder — multi-strategy (matches Dumper-7)
// ========================================================================

static uintptr_t FindAppendString(void (*log)(const char*, ...) = nullptr)
{
    auto text = GetSection(".text");
    if (!text.base || !text.size) return 0;
    uintptr_t modBase, modSize;
    if (!GetModuleRange(modBase, modSize)) return 0;

    // --- Strategy 1: String XREF "ForwardShadingQuality_" + nearby CALL pattern ---
    const char* xrefStrings[] = {
        "ForwardShadingQuality_",
        "ViewDistanceQuality_",
        "ShadowQuality_",
    };

    uintptr_t xref = 0;
    for (auto* s : xrefStrings)
    {
        xref = FindAnsiStringXRef(s, log);
        if (xref)
        {
            if (log) log("  [Resolver] String XREF '%s' at 0x%p", s, (void*)xref);
            break;
        }
    }

    if (xref)
    {
        // Primary patterns (Dumper-7 signatures)
        const char* patterns[] = {
            "48 8D ?? ?? 48 8D ?? ?? E8",
            "48 8D ?? ?? ?? 48 8D ?? ?? E8",
            "48 8D ?? ?? 49 8B ?? E8",
            "48 8D ?? ?? ?? 49 8B ?? E8",
            "48 8D ?? ?? 48 8B ?? E8",
            "48 8D ?? ?? ?? 48 8B ?? E8",
        };

        for (auto* pat : patterns)
        {
            auto parsed = ParsePattern(pat);
            auto match = ScanRegion(xref, 0x50, parsed);
            if (match)
            {
                auto callAddr = match + parsed.size() - 1;
                auto target = ResolveE8Call(callAddr);
                if (target)
                {
                    if (log) log("  [Resolver] AppendString at 0x%p (primary pattern)", (void*)target);
                    return target;
                }
            }
        }

        // --- Strategy 2: Inlined AppendString (newer UE versions) ---
        // Pattern: 8B ?? ?? E8 ?? ?? ?? ?? 48 8D ?? ?? ?? 48 8B C8 E8
        // The second E8 CALL is AppendString (inlined via GetNameEntry + GetName)
        {
            auto parsed = ParsePattern("8B ?? ?? E8 ?? ?? ?? ?? 48 8D ?? ?? ?? 48 8B C8 E8");
            auto match = ScanRegion(xref, 0x180, parsed);
            if (match)
            {
                // The second E8 is at offset 0x10 from match start
                auto callAddr = match + 0x10;
                auto target = ResolveE8Call(callAddr);
                if (target)
                {
                    if (log) log("  [Resolver] AppendString at 0x%p (inlined pattern)", (void*)target);
                    return target;
                }
            }
        }

        // Strategy 3: Brute-force scan region after XREF for any E8 CALL
        for (uintptr_t a = xref; a < xref + 0x100 && a + 5 < modBase + modSize; a++)
        {
            auto target = ResolveE8Call(a);
            if (target)
            {
                auto b = *(uint8_t*)target;
                if (b == 0x40 || b == 0x48 || b == 0x55 || b == 0x56 || b == 0x57 || b == 0x41)
                {
                    if (log) log("  [Resolver] AppendString at 0x%p (brute-force after XREF)", (void*)target);
                    return target;
                }
            }
        }
    }

    // --- Strategy 4: Backup string XREF L" Bone: " (wide) and search backwards ---
    uintptr_t boneXref = FindWideStringXRef(L" Bone: ", log);
    if (boneXref)
    {
        if (log) log("  [Resolver] Trying backup L' Bone: ' XREF at 0x%p", (void*)boneXref);
        uintptr_t searchStart = (boneXref > 0xB0) ? (boneXref - 0xB0) : text.base;
        size_t searchLen = boneXref - searchStart + 0x50;

        // Dumper-7 backup patterns
        const char* backupPats[] = {
            "48 8B ?? 48 8B ?? ?? E8",
            "48 8B ?? ?? 48 89 ?? ?? E8",
            "48 8B ?? 48 89 ?? ?? ?? E8",
        };
        for (auto* pat : backupPats)
        {
            auto parsed = ParsePattern(pat);
            auto match = ScanRegion(searchStart, searchLen, parsed);
            if (match)
            {
                auto callAddr = match + parsed.size() - 1;
                auto target = ResolveE8Call(callAddr);
                if (target)
                {
                    if (log) log("  [Resolver] AppendString at 0x%p (Bone backup)", (void*)target);
                    return target;
                }
            }
        }
    }

    if (log) log("  [Resolver] AppendString NOT FOUND");
    return 0;
}

// ========================================================================
// ProcessEventIdx finder — VTable scan
// ========================================================================
// ProcessEvent's body contains TEST instructions checking:
//   FunctionFlags & 0x0400     (FUNC_Native)
//   FunctionFlags & 0x400000   (FUNC_HasOutParms)

// Helper: check if a VTable function contains TEST [reg+disp], imm32 patterns
// matching ProcessEvent's characteristic flag checks.
static bool IsProcessEventCandidate(uintptr_t fn)
{
    if (!IsAddressInExecutableSection(fn)) return false;

    bool hasNative = false;      // TEST ..., 0x00000400  (FUNC_Native)
    bool hasOutParms = false;    // TEST ..., 0x00400000  (FUNC_HasOutParms)

    // Scan for TEST (F7) with immediate 0x00000400 within first 0x400 bytes
    for (size_t off = 0; off < 0x400 && !hasNative; off++)
    {
        if (*(uint8_t*)(fn + off) == 0xF7)
        {
            for (int d = 2; d <= 8 && off + d + 3 < 0x400; d++)
            {
                if (*(uint32_t*)(fn + off + d) == 0x00000400)
                {
                    hasNative = true;
                    break;
                }
            }
        }
    }
    if (!hasNative) return false;

    // Scan for TEST (F7) with immediate 0x00400000 within first 0xF00 bytes
    for (size_t off = 0; off < 0xF00 && !hasOutParms; off++)
    {
        if (*(uint8_t*)(fn + off) == 0xF7)
        {
            for (int d = 2; d <= 8 && off + d + 3 < 0xF00; d++)
            {
                if (*(uint32_t*)(fn + off + d) == 0x00400000)
                {
                    hasOutParms = true;
                    break;
                }
            }
        }
    }

    return hasNative && hasOutParms;
}

// Walk forward from an address to find next function start (after CC/C3 padding)
static uintptr_t FindNextFunctionStart(uintptr_t addr)
{
    // Scan forward for INT3 (CC) or RET (C3) padding then function start
    for (size_t i = 0; i < 0x1000; i++)
    {
        uint8_t b = *(uint8_t*)(addr + i);
        if (b == 0xC3 || b == 0xCC)
        {
            // Skip all CC padding
            size_t j = i + 1;
            while (j < i + 0x20 && *(uint8_t*)(addr + j) == 0xCC) j++;
            // Align to 16-byte boundary
            uintptr_t candidate = addr + j;
            if (candidate % 0x10 != 0)
                candidate = candidate + (0x10 - (candidate % 0x10));
            return candidate;
        }
    }
    return 0;
}

static int32_t FindProcessEventIdx(uintptr_t gobjectsAddr, void (*log)(const char*, ...) = nullptr)
{
    if (!gobjectsAddr) return -1;
    auto text = GetSection(".text");
    if (!text.base) return -1;

    __try
    {
        auto** chunks = *(void***)(gobjectsAddr);
        if (!chunks || !chunks[0]) return -1;

        // Get first non-null object
        uintptr_t firstObj = 0;
        for (int i = 0; i < 100; i++)
        {
            auto obj = *(uintptr_t*)((uint8_t*)chunks[0] + (uintptr_t)i * 0x18);
            if (obj > 0x10000) { firstObj = obj; break; }
        }
        if (!firstObj) return -1;

        auto** vt = *(void***)firstObj;
        if (!vt) return -1;

        // --- Primary: scan VTable for TEST FunctionFlags patterns ---
        for (int idx = 0; idx < 0x150; idx++)
        {
            auto fn = (uintptr_t)vt[idx];
            __try
            {
                if (!fn || fn < 0x10000) continue;
                // Resolve JMP chains (thunks)
                for (int j = 0; j < 5 && *(uint8_t*)fn == 0xE9; j++)
                    fn = fn + 5 + *(int32_t*)(fn + 1);

                if (IsProcessEventCandidate(fn))
                {
                    if (log) log("  [Resolver] ProcessEvent at VTable[0x%X] = 0x%p", idx, (void*)fn);
                    return idx;
                }
            }
            __except (EXCEPTION_EXECUTE_HANDLER) { continue; }
        }

        // --- Fallback: find L"Accessed None" string ref, next function is often ProcessEvent ---
        if (log) log("  [Resolver] Primary PE scan failed, trying 'Accessed None' fallback...");
        uintptr_t accessedNoneXref = FindWideStringXRef(L"Accessed None", nullptr);
        if (accessedNoneXref)
        {
            if (log) log("  [Resolver] 'Accessed None' XREF at 0x%p", (void*)accessedNoneXref);
            uintptr_t nextFunc = FindNextFunctionStart(accessedNoneXref);
            if (nextFunc && IsAddressInExecutableSection(nextFunc))
            {
                if (log) log("  [Resolver] Next function after 'Accessed None' at 0x%p", (void*)nextFunc);
                // Find this address in the VTable
                for (int idx = 0; idx < 0x150; idx++)
                {
                    auto fn = (uintptr_t)vt[idx];
                    __try
                    {
                        if (!fn) continue;
                        for (int j = 0; j < 5 && *(uint8_t*)fn == 0xE9; j++)
                            fn = fn + 5 + *(int32_t*)(fn + 1);
                        if (fn == nextFunc)
                        {
                            if (log) log("  [Resolver] ProcessEvent (Accessed None fallback) at VTable[0x%X] = 0x%p", idx, (void*)fn);
                            return idx;
                        }
                    }
                    __except (EXCEPTION_EXECUTE_HANDLER) { continue; }
                }
            }
        }
    }
    __except (EXCEPTION_EXECUTE_HANDLER) {}

    if (log) log("  [Resolver] ProcessEventIdx NOT FOUND");
    return -1;
}

// ========================================================================
// AppendString validation — test if a candidate address actually works
// ========================================================================
static bool ValidateAppendString(uintptr_t appendStringAddr, uintptr_t gobjectsAddr,
                                  void (*log)(const char*, ...) = nullptr)
{
    if (!appendStringAddr || !gobjectsAddr) return false;

    __try
    {
        auto** chunks = *(void***)(gobjectsAddr);
        if (!chunks || !chunks[0]) return false;

        // Find a valid object (skip index 0 which may be null)
        uintptr_t obj = 0;
        for (int k = 1; k <= 10; k++)
        {
            obj = *(uintptr_t*)((uint8_t*)chunks[0] + (uintptr_t)k * 0x18);
            if (obj && obj > 0x10000) break;
            obj = 0;
        }
        if (!obj) return false;

        // FName is at offset 0x18 in UObject
        const void* fnamePtr = (const void*)(obj + 0x18);

        // Prepare a stack-based FString (wchar_t buffer)
        wchar_t buffer[512] = {};
        struct { wchar_t* Data; int32_t Count; int32_t Max; } tempStr = { buffer, 0, 512 };

        // Call AppendString: void (*)(const FName*, FString&)
        auto fn = reinterpret_cast<void(*)(const void*, void*)>(appendStringAddr);
        fn(fnamePtr, &tempStr);

        // Check: Count > 0, reasonable length, printable first char
        if (tempStr.Count > 0 && tempStr.Count < 500 && buffer[0] >= 0x20)
        {
            if (log)
            {
                char narrow[128] = {};
                for (int i = 0; i < tempStr.Count && i < 127; i++)
                    narrow[i] = (buffer[i] < 128) ? (char)buffer[i] : '?';
                log("  [Resolver] AppendString validation OK: \"%s\"", narrow);
            }
            return true;
        }

        if (log) log("  [Resolver] AppendString validation failed: Count=%d", tempStr.Count);
        return false;
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        if (log) log("  [Resolver] AppendString validation CRASHED (wrong address)");
        return false;
    }
}

// ========================================================================
// Combined resolver — called from worker thread
// ========================================================================
// Phase order: GObjects first (has wait loop ensuring game init),
// then AppendString (code is loaded), then ProcessEventIdx.

static bool ResolveAndInitSDK(int timeoutSeconds,
                              void (*log)(const char*, ...) = nullptr,
                              SDK::TUObjectArrayWrapper& GObjects = SDK::UObject::GObjects,
                              int stabilizeMs = 2000)
{
    uintptr_t moduleBase = (uintptr_t)GetModuleHandleA(nullptr);
    if (log) log("[Resolver] Module base: 0x%p", (void*)moduleBase);

    // --- Phase 1: Find GObjects + wait for initialization ---
    // Runs first: its wait loop ensures game code sections are fully loaded.
    if (log) log("[Resolver] Phase 1: Scanning for GObjects (waiting for game init)...");
    uintptr_t gobjects = 0;
    uintptr_t gobjectsCandidate = 0;

    for (int i = 0; i < timeoutSeconds * 2; i++)
    {
        Sleep(500);

        if (!gobjectsCandidate)
        {
            gobjectsCandidate = FindGObjects(nullptr);
            if (gobjectsCandidate && log)
                log("  GObjects candidate at 0x%p, waiting for population...", (void*)gobjectsCandidate);
        }

        if (gobjectsCandidate)
        {
            __try
            {
                auto numElem = *(int32_t*)(gobjectsCandidate + 0x14);
                if (numElem > 5000)
                {
                    auto** chunks = *(void***)(gobjectsCandidate);
                    if (chunks && chunks[0])
                    {
                        auto obj5 = *(uintptr_t*)((uint8_t*)chunks[0] + 5 * 0x18);
                        if (obj5 && *(int32_t*)(obj5 + 0x0C) == 5)
                        {
                            gobjects = gobjectsCandidate;
                            if (log) log("  GObjects ready at 0x%p (%d objects)", (void*)gobjects, numElem);
                            break;
                        }
                    }
                }
            }
            __except (EXCEPTION_EXECUTE_HANDLER)
            {
                gobjectsCandidate = 0;
            }
        }
    }

    if (!gobjects)
    {
        if (log) log("[Resolver] ERROR: GObjects not found or not initialized within %ds", timeoutSeconds);
        return false;
    }

    GObjects.InitManually(reinterpret_cast<void*>(gobjects));
    SDK::Offsets::GObjects = static_cast<int32_t>(gobjects - moduleBase);
    if (log) log("  GObjects resolved -> RVA 0x%08X", SDK::Offsets::GObjects);

    // --- Phase 2: Resolve FNamePool before using AppendString ---
    if (log) log("[Resolver] Phase 2: Scanning for FNamePool...");
    const bool namePoolReady = SDK::NamePool::Initialize(gobjects, log);

    // --- Phase 3: Resolve AppendString as a per-name fallback ---
    // Keep this separate from pool initialization: GetRawString() can still
    // use it when a pool entry is malformed or unsupported.
    uintptr_t appendStr = 0;
    {
        if (log) log("[Resolver] Phase 3: Scanning for FName::AppendString fallback...");
        appendStr = FindAppendString(log);

        // Retry once after delay if not found
        if (!appendStr)
        {
            if (log) log("  First scan failed, retrying after 2s...");
            Sleep(2000);
            appendStr = FindAppendString(log);
        }

        if (appendStr)
        {
            if (ValidateAppendString(appendStr, gobjects, log))
            {
                SDK::FName::InitManually(reinterpret_cast<void*>(appendStr));
                SDK::Offsets::AppendString = static_cast<int32_t>(appendStr - moduleBase);
                if (log) log("  AppendString resolved -> RVA 0x%08X", SDK::Offsets::AppendString);
            }
            else
            {
                if (log) log("  AppendString scan result failed validation, trying fallbacks...");
                appendStr = 0;
            }
        }

        if (!appendStr)
        {
            // Fallback A: estimate from GObjects offset shift
            int32_t oldGObjectsRVA = 0x08EE2F98;
            int32_t oldAppendStringRVA = 0x02A39360;
            int32_t shift = SDK::Offsets::GObjects - oldGObjectsRVA;

            if (shift != 0)
            {
                int32_t estimatedRVA = oldAppendStringRVA + shift;
                uintptr_t estimatedAddr = moduleBase + estimatedRVA;
                if (log) log("  Trying shift-estimated AppendString: RVA 0x%08X (shift=%+d)", estimatedRVA, shift);

                if (ValidateAppendString(estimatedAddr, gobjects, log))
                {
                    SDK::FName::InitManually(reinterpret_cast<void*>(estimatedAddr));
                    SDK::Offsets::AppendString = estimatedRVA;
                    appendStr = estimatedAddr;
                    if (log) log("  AppendString (shift-estimated) -> RVA 0x%08X", estimatedRVA);
                }
            }

            // Fallback B: try raw hardcoded fallback with validation
            if (!appendStr)
            {
                uintptr_t fallbackAddr = moduleBase + oldAppendStringRVA;
                if (log) log("  Trying raw fallback AppendString: RVA 0x%08X", oldAppendStringRVA);

                if (ValidateAppendString(fallbackAddr, gobjects, log))
                {
                    SDK::FName::InitManually(reinterpret_cast<void*>(fallbackAddr));
                    SDK::Offsets::AppendString = oldAppendStringRVA;
                    appendStr = fallbackAddr;
                    if (log) log("  AppendString fallback accepted -> RVA 0x%08X", oldAppendStringRVA);
                }
                else
                {
                    if (log)
                    {
                        if (namePoolReady)
                            log("  AppendString fallback unavailable; direct FNamePool decoding remains active.");
                        else
                            log("  ERROR: FNamePool and all AppendString strategies failed; names disabled.");
                    }
                }
            }
        }
    }

    // --- Phase 4: Find ProcessEvent VTable index ---
    if (log) log("[Resolver] Phase 4: Scanning for ProcessEvent VTable index...");
    auto peIdx = FindProcessEventIdx(gobjects, log);
    if (peIdx >= 0)
    {
        SDK::Offsets::ProcessEventIdx = peIdx;

        // Also resolve ProcessEvent absolute RVA
        __try
        {
            auto** chunks = *(void***)(gobjects);
            uintptr_t firstObj = 0;
            for (int i = 0; i < 100; i++)
            {
                auto obj = *(uintptr_t*)((uint8_t*)chunks[0] + (uintptr_t)i * 0x18);
                if (obj > 0x10000) { firstObj = obj; break; }
            }
            if (firstObj)
            {
                auto** vt = *(void***)firstObj;
                auto fn = (uintptr_t)vt[peIdx];
                for (int j = 0; j < 5 && *(uint8_t*)fn == 0xE9; j++)
                    fn = fn + 5 + *(int32_t*)(fn + 1);
                SDK::Offsets::ProcessEvent = static_cast<int32_t>(fn - moduleBase);
            }
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {}

        if (log) log("  ProcessEventIdx -> 0x%X, ProcessEvent RVA -> 0x%08X",
            peIdx, SDK::Offsets::ProcessEvent);
    }
    else
    {
        if (log) log("  ProcessEventIdx not found, using fallback 0x%X", SDK::Offsets::ProcessEventIdx);
    }

    // Brief stabilization wait
    if (stabilizeMs > 0)
    {
        if (log) log("[Resolver] All offsets resolved. Stabilizing (%dms)...", stabilizeMs);
        Sleep(stabilizeMs);
    }

    if (log) log("[Resolver] SDK initialization complete.");
    return true;
}

} // namespace DynamicResolver
