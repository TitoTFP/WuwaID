#pragma once
// DynamicResolver.hpp - Runtime SDK offset resolution via pattern scanning
// Finds GObjects, FName::AppendString, and ProcessEvent VTable index dynamically
// so the DLL survives game patches without recompilation.
//
// Uses the same strategies as Dumper-7:
//   GObjects:        structural validation in .data section
//   AppendString:    string XREF "ForwardShadingQuality_" -> nearby CALL target
//   ProcessEventIdx: VTable scan for TEST FunctionFlags with 0x400 and 0x4000

#include <windows.h>
#include <cstdint>
#include <cstdio>
#include <vector>

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
    for (int i = 0; i < nt->FileHeader.NumberOfSections; i++)
    {
        if (memcmp(sect[i].Name, name, nameLen) == 0)
            return { (uintptr_t)m + sect[i].VirtualAddress, sect[i].Misc.VirtualSize };
    }
    return { 0, 0 };
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
// AppendString finder — string XREF + CALL resolution
// ========================================================================

// Find a LEA rip-relative instruction that points to a given C string
static uintptr_t FindStringXRef(const char* target, uintptr_t searchBase, size_t searchSize,
                                uintptr_t modBase, size_t modSize)
{
    size_t targetLen = strlen(target);
    for (uintptr_t a = searchBase; a + 7 <= searchBase + searchSize; a++)
    {
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
                        return a;
                }
                __except (EXCEPTION_EXECUTE_HANDLER) {}
            }
        }
    }
    return 0;
}

static uintptr_t FindAppendString(void (*log)(const char*, ...) = nullptr)
{
    auto text = GetSection(".text");
    if (!text.base || !text.size) return 0;
    uintptr_t modBase, modSize;
    if (!GetModuleRange(modBase, modSize)) return 0;

    // Try multiple string XREFs — "ForwardShadingQuality_" is primary (as in Dumper-7)
    const char* xrefStrings[] = {
        "ForwardShadingQuality_",
        "ViewDistanceQuality_",
        "ShadowQuality_",
    };

    uintptr_t xref = 0;
    for (auto* s : xrefStrings)
    {
        xref = FindStringXRef(s, text.base, text.size, modBase, modSize);
        if (xref)
        {
            if (log) log("  [Resolver] String XREF '%s' at 0x%p", s, (void*)xref);
            break;
        }
    }
    if (!xref) { if (log) log("  [Resolver] AppendString NOT FOUND (no XREF)"); return 0; }

    // Search within 0x60 bytes after XREF for patterns ending with E8 (CALL)
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
        auto match = ScanRegion(xref, 0x60, parsed);
        if (match)
        {
            // E8 is last byte of the pattern
            auto callAddr = match + parsed.size() - 1;
            if (*(uint8_t*)callAddr == 0xE8)
            {
                auto rel = *(int32_t*)(callAddr + 1);
                auto target = callAddr + 5 + rel;
                if (target >= text.base && target < text.base + text.size)
                {
                    if (log) log("  [Resolver] AppendString at 0x%p", (void*)target);
                    return target;
                }
            }
        }
    }

    // Fallback: scan region after XREF for any E8 CALL with a valid target
    for (uintptr_t a = xref; a < xref + 0x100 && a + 5 < text.base + text.size; a++)
    {
        if (*(uint8_t*)a == 0xE8)
        {
            auto rel = *(int32_t*)(a + 1);
            auto target = a + 5 + rel;
            if (target > text.base && target < text.base + text.size)
            {
                // AppendString prologue usually starts with sub rsp / push rbx etc.
                auto b = *(uint8_t*)target;
                if (b == 0x40 || b == 0x48 || b == 0x55 || b == 0x56 || b == 0x57 || b == 0x41)
                {
                    if (log) log("  [Resolver] AppendString (fallback) at 0x%p", (void*)target);
                    return target;
                }
            }
        }
    }

    // Backup: string XREF " Bone: " and search backwards
    xref = FindStringXRef(" Bone: ", text.base, text.size, modBase, modSize);
    if (xref)
    {
        if (log) log("  [Resolver] Trying backup ' Bone: ' XREF at 0x%p", (void*)xref);
        uintptr_t searchStart = (xref > 0xB0) ? (xref - 0xB0) : text.base;
        size_t searchLen = xref - searchStart;

        const char* backupPats[] = { "48 8D ?? ?? E8", "48 8D ?? ?? ?? E8" };
        for (auto* pat : backupPats)
        {
            auto parsed = ParsePattern(pat);
            auto match = ScanRegion(searchStart, searchLen, parsed);
            if (match)
            {
                auto callAddr = match + parsed.size() - 1;
                if (*(uint8_t*)callAddr == 0xE8)
                {
                    auto rel = *(int32_t*)(callAddr + 1);
                    auto target = callAddr + 5 + rel;
                    if (target >= text.base && target < text.base + text.size)
                    {
                        if (log) log("  [Resolver] AppendString (backup) at 0x%p", (void*)target);
                        return target;
                    }
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
//   FunctionFlags & 0x0400  (FUNC_Native)
//   FunctionFlags & 0x4000  (within larger range)

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

        for (int idx = 0; idx < 0x150; idx++)
        {
            auto fn = (uintptr_t)vt[idx];

            __try
            {
                // Resolve JMP chains (thunks)
                for (int j = 0; j < 5 && *(uint8_t*)fn == 0xE9; j++)
                    fn = fn + 5 + *(int32_t*)(fn + 1);

                if (fn < text.base || fn >= text.base + text.size) continue;

                // Scan for TEST with immediate 0x0400 (within first 0x400 bytes)
                bool has400 = false, has4000 = false;

                for (size_t off = 0; off < 0x400 && !has400; off++)
                {
                    if (*(uint8_t*)(fn + off) == 0xF7)
                    {
                        for (int d = 2; d <= 8 && off + d + 3 < 0x400; d++)
                        {
                            if (*(uint32_t*)(fn + off + d) == 0x0400)
                            {
                                has400 = true;
                                break;
                            }
                        }
                    }
                }

                if (!has400) continue;

                // Scan for TEST with immediate 0x4000 (within first 0xF00 bytes)
                for (size_t off = 0; off < 0xF00 && !has4000; off++)
                {
                    if (*(uint8_t*)(fn + off) == 0xF7)
                    {
                        for (int d = 2; d <= 8 && off + d + 3 < 0xF00; d++)
                        {
                            if (*(uint32_t*)(fn + off + d) == 0x4000)
                            {
                                has4000 = true;
                                break;
                            }
                        }
                    }
                }

                if (has400 && has4000)
                {
                    if (log) log("  [Resolver] ProcessEvent at VTable[0x%X] = 0x%p", idx, (void*)fn);
                    return idx;
                }
            }
            __except (EXCEPTION_EXECUTE_HANDLER) { continue; }
        }
    }
    __except (EXCEPTION_EXECUTE_HANDLER) {}

    if (log) log("  [Resolver] ProcessEventIdx NOT FOUND");
    return -1;
}

// ========================================================================
// Combined resolver — called from worker thread
// ========================================================================
// Replaces WaitForSDK(): scans for offsets AND waits for game initialization.
// Returns true if SDK is usable.

static bool ResolveAndInitSDK(int timeoutSeconds,
                              void (*log)(const char*, ...) = nullptr,
                              SDK::TUObjectArrayWrapper& GObjects = SDK::UObject::GObjects)
{
    uintptr_t moduleBase = (uintptr_t)GetModuleHandleA(nullptr);
    if (log) log("[Resolver] Module base: 0x%p", (void*)moduleBase);

    // --- Phase 1: Find AppendString (code pattern, no timing dependency) ---
    if (log) log("[Resolver] Phase 1: Scanning for FName::AppendString...");
    uintptr_t appendStr = FindAppendString(log);
    if (appendStr)
    {
        SDK::FName::InitManually(reinterpret_cast<void*>(appendStr));
        SDK::Offsets::AppendString = static_cast<int32_t>(appendStr - moduleBase);
        if (log) log("  AppendString resolved -> RVA 0x%08X", SDK::Offsets::AppendString);
    }
    else
    {
        if (log) log("  AppendString not found, using fallback RVA 0x%08X", SDK::Offsets::AppendString);
    }

    // --- Phase 2: Find GObjects + wait for initialization ---
    if (log) log("[Resolver] Phase 2: Scanning for GObjects (waiting for game init)...");
    uintptr_t gobjects = 0;
    uintptr_t gobjectsCandidate = 0;

    for (int i = 0; i < timeoutSeconds * 2; i++)
    {
        Sleep(500);

        if (!gobjectsCandidate)
        {
            gobjectsCandidate = FindGObjects(nullptr); // quiet scan
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
                    // Re-validate structure before accepting
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
                gobjectsCandidate = 0; // Invalid, rescan
            }
        }
    }

    if (!gobjects)
    {
        if (log) log("[Resolver] ERROR: GObjects not found or not initialized within %ds", timeoutSeconds);
        return false;
    }

    // Initialize SDK GObjects
    GObjects.InitManually(reinterpret_cast<void*>(gobjects));
    SDK::Offsets::GObjects = static_cast<int32_t>(gobjects - moduleBase);
    if (log) log("  GObjects resolved -> RVA 0x%08X", SDK::Offsets::GObjects);

    // --- Phase 3: Find ProcessEvent VTable index ---
    if (log) log("[Resolver] Phase 3: Scanning for ProcessEvent VTable index...");
    auto peIdx = FindProcessEventIdx(gobjects, log);
    if (peIdx >= 0)
    {
        SDK::Offsets::ProcessEventIdx = peIdx;
        if (log) log("  ProcessEventIdx resolved -> 0x%X (%d)", peIdx, peIdx);
    }
    else
    {
        if (log) log("  ProcessEventIdx not found, using fallback 0x%X", SDK::Offsets::ProcessEventIdx);
    }

    // Let game stabilize after init
    if (log) log("[Resolver] All offsets resolved. Waiting for game to stabilize...");
    Sleep(15000);

    return true;
}

} // namespace DynamicResolver
