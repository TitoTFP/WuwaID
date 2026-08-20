#pragma once

#include <windows.h>

#include <cstdint>
#include <climits>
#include <cstring>
#include <string>
#include <utility>

namespace SDK::NamePool
{

struct Layout
{
    uintptr_t PoolAddress = 0;
    uint32_t BlockOffsetBits = 16;
    uint32_t HeaderOffset = 0;
    uint32_t StringOffset = 2;
    uint32_t EntryStride = 2;
    uint32_t LengthShift = 1;
};

namespace Detail
{
    inline Layout CurrentLayout{};
    inline bool Initialized = false;

    inline bool IsReadable(const void* address, size_t size)
    {
        if (!address || size == 0)
            return false;

        const uintptr_t begin = reinterpret_cast<uintptr_t>(address);
        if (begin > UINTPTR_MAX - size)
            return false;

        MEMORY_BASIC_INFORMATION info{};
        if (VirtualQuery(address, &info, sizeof(info)) != sizeof(info))
            return false;

        const uintptr_t regionBegin = reinterpret_cast<uintptr_t>(info.BaseAddress);
        const uintptr_t regionEnd = regionBegin + info.RegionSize;
        if (begin < regionBegin || begin + size > regionEnd || info.State != MEM_COMMIT)
            return false;

        const DWORD protection = info.Protect & 0xFF;
        if (info.Protect & PAGE_GUARD || protection == PAGE_NOACCESS)
            return false;

        return protection == PAGE_READONLY || protection == PAGE_READWRITE ||
               protection == PAGE_WRITECOPY || protection == PAGE_EXECUTE_READ ||
               protection == PAGE_EXECUTE_READWRITE || protection == PAGE_EXECUTE_WRITECOPY;
    }

    inline bool ReadBytes(const void* address, void* output, size_t size)
    {
        if (!IsReadable(address, size))
            return false;

        __try
        {
            memcpy(output, address, size);
            return true;
        }
        __except (EXCEPTION_EXECUTE_HANDLER)
        {
            return false;
        }
    }

    inline bool ReadU16(const void* address, uint16_t& output)
    {
        return ReadBytes(address, &output, sizeof(output));
    }

    inline bool ReadU32(const void* address, uint32_t& output)
    {
        return ReadBytes(address, &output, sizeof(output));
    }

    inline bool ReadPointer(const void* address, uintptr_t& output)
    {
        return ReadBytes(address, &output, sizeof(output));
    }

    inline bool IsValidLength(uint32_t length, bool wide)
    {
        return length > 0 && length <= 1024 &&
               (!wide || length <= 512);
    }

    inline bool IsPlausibleString(const std::string& value)
    {
        if (value.empty() || value.size() > 1024)
            return false;

        for (unsigned char ch : value)
        {
            if (ch < 0x20 || ch == 0x7F)
                return false;
        }
        return true;
    }

    inline bool HasBytes(const uint8_t* address, size_t size,
                         const char* value, size_t valueSize)
    {
        if (!address || !value || valueSize == 0 || size < valueSize)
            return false;

        for (size_t i = 0; i <= size - valueSize; i++)
        {
            if (memcmp(address + i, value, valueSize) == 0)
                return true;
        }
        return false;
    }

    inline size_t FindBytes(const uint8_t* address, size_t size,
                            const char* value, size_t valueSize)
    {
        if (!address || !value || valueSize == 0 || size < valueSize)
            return SIZE_MAX;

        for (size_t i = 0; i <= size - valueSize; i++)
        {
            if (memcmp(address + i, value, valueSize) == 0)
                return i;
        }
        return SIZE_MAX;
    }

    inline bool HasWideBytes(const uint8_t* address, size_t size,
                             const char* value, size_t valueSize)
    {
        if (!address || !value || valueSize == 0 || size < valueSize * 2)
            return false;

        for (size_t i = 0; i <= size - valueSize * 2; i += 2)
        {
            bool match = true;
            for (size_t j = 0; j < valueSize; j++)
            {
                if (address[i + j * 2] != static_cast<uint8_t>(value[j]) ||
                    address[i + j * 2 + 1] != 0)
                {
                    match = false;
                    break;
                }
            }
            if (match)
                return true;
        }
        return false;
    }

    inline size_t FindWideBytes(const uint8_t* address, size_t size,
                                const char* value, size_t valueSize)
    {
        if (!address || !value || valueSize == 0 || size < valueSize * 2)
            return SIZE_MAX;

        for (size_t i = 0; i <= size - valueSize * 2; i += 2)
        {
            bool match = true;
            for (size_t j = 0; j < valueSize; j++)
            {
                if (address[i + j * 2] != static_cast<uint8_t>(value[j]) ||
                    address[i + j * 2 + 1] != 0)
                {
                    match = false;
                    break;
                }
            }
            if (match)
                return i;
        }
        return SIZE_MAX;
    }

    inline bool DecodeWide(const uint8_t* address, uint32_t length, std::string& output)
    {
        if (!IsValidLength(length, true) || !IsReadable(address, length * sizeof(wchar_t)))
            return false;

        int required = WideCharToMultiByte(CP_UTF8, 0,
            reinterpret_cast<const wchar_t*>(address), static_cast<int>(length),
            nullptr, 0, nullptr, nullptr);
        if (required <= 0)
            return false;

        std::string converted(static_cast<size_t>(required), '\0');
        if (WideCharToMultiByte(CP_UTF8, 0,
            reinterpret_cast<const wchar_t*>(address), static_cast<int>(length),
            converted.data(), required, nullptr, nullptr) <= 0)
            return false;

        output = std::move(converted);
        return true;
    }

    inline bool DecodeEntry(uint32_t comparisonIndex, uint32_t number,
                            std::string& output, int depth)
    {
        if (!Initialized || depth > 4 || comparisonIndex > INT32_MAX)
            return false;

        const Layout& layout = CurrentLayout;
        if (layout.BlockOffsetBits < 1 || layout.BlockOffsetBits > 20)
            return false;

        const uint32_t blockSize = 1u << layout.BlockOffsetBits;
        const uint32_t blockIndex = comparisonIndex >> layout.BlockOffsetBits;
        const uint32_t entryIndex = comparisonIndex & (blockSize - 1);

        uint32_t currentBlock = 0;
        uint32_t currentByteCursor = 0;
        uintptr_t block = 0;
        if (!ReadU32(reinterpret_cast<const void*>(layout.PoolAddress + 0x8), currentBlock) ||
            !ReadU32(reinterpret_cast<const void*>(layout.PoolAddress + 0xC), currentByteCursor) ||
            blockIndex > currentBlock || currentBlock > 0x10000 ||
            !ReadPointer(reinterpret_cast<const void*>(layout.PoolAddress + 0x10 +
                static_cast<uintptr_t>(blockIndex) * sizeof(uintptr_t)), block) ||
            !block)
            return false;

        const uintptr_t entryOffset = static_cast<uintptr_t>(entryIndex) * layout.EntryStride;
        if (blockIndex == currentBlock && entryOffset >= currentByteCursor)
            return false;

        const uintptr_t entryAddress = block + entryOffset;
        uint16_t header = 0;
        if (!ReadU16(reinterpret_cast<const void*>(entryAddress + layout.HeaderOffset), header))
            return false;

        const bool wide = (header & 1u) != 0;
        const uint32_t length = header >> layout.LengthShift;

        if (length == 0)
        {
            const uintptr_t numberOffset = layout.StringOffset +
                ((layout.StringOffset == 6) ? 2 : 0);
            uint32_t nextIndex = 0;
            uint32_t entryNumber = 0;
            if (!ReadU32(reinterpret_cast<const void*>(entryAddress + numberOffset), nextIndex) ||
                !ReadU32(reinterpret_cast<const void*>(entryAddress + numberOffset + 4), entryNumber) ||
                !DecodeEntry(nextIndex, 0, output, depth + 1))
                return false;

            const uint32_t suffixNumber = entryNumber ? entryNumber : number;
            if (suffixNumber > 0)
                output += '_' + std::to_string(suffixNumber - 1);
            return IsPlausibleString(output);
        }

        if (!IsValidLength(length, wide))
            return false;

        const uintptr_t stringAddress = entryAddress + layout.StringOffset;
        if (wide)
        {
            if (!DecodeWide(reinterpret_cast<const uint8_t*>(stringAddress), length, output))
                return false;
        }
        else
        {
            if (!IsReadable(reinterpret_cast<const void*>(stringAddress), length))
                return false;
            output.assign(reinterpret_cast<const char*>(stringAddress), length);
        }

        if (number > 0)
            output += '_' + std::to_string(number - 1);
        return IsPlausibleString(output);
    }
}

inline bool FindLayout(uintptr_t poolAddress, Layout& output)
{
    if (!poolAddress || !Detail::IsReadable(reinterpret_cast<const void*>(poolAddress), 0x18))
        return false;

    uint32_t currentBlock = 0;
    uint32_t currentByteCursor = 0;
    uintptr_t firstBlock = 0;
    if (!Detail::ReadU32(reinterpret_cast<const void*>(poolAddress + 0x8), currentBlock) ||
        !Detail::ReadU32(reinterpret_cast<const void*>(poolAddress + 0xC), currentByteCursor) ||
        !Detail::ReadPointer(reinterpret_cast<const void*>(poolAddress + 0x10), firstBlock) ||
        currentBlock > 0x10000 || currentByteCursor > 0x20000 || !firstBlock ||
        !Detail::IsReadable(reinterpret_cast<const void*>(firstBlock), 0x1000))
        return false;

    Layout layouts[] = {
        { 0, 16, 0, 2, 2, 1 },
        { 0, 16, 4, 6, 4, 1 },
    };

    for (const Layout& candidate : layouts)
    {
        uint16_t header = 0;
        if (!Detail::ReadU16(reinterpret_cast<const void*>(firstBlock + candidate.HeaderOffset), header))
            continue;

        if ((header & 1u) != 0)
            continue;

        char none[4]{};
        if (!Detail::ReadBytes(reinterpret_cast<const void*>(firstBlock + candidate.StringOffset), none, 4) ||
            memcmp(none, "None", 4) != 0)
            continue;

        const auto* bytes = reinterpret_cast<const uint8_t*>(firstBlock);
        const size_t bytePropertyOffset = Detail::FindBytes(
            bytes, 0x1000, "ByteProperty", 12);
        const size_t wideBytePropertyOffset = Detail::FindWideBytes(
            bytes, 0x1000, "ByteProperty", 12);
        const size_t nameOffset = bytePropertyOffset != SIZE_MAX
            ? bytePropertyOffset : wideBytePropertyOffset;
        if (nameOffset == SIZE_MAX || nameOffset < candidate.StringOffset)
            continue;

        uint16_t bytePropertyHeader = 0;
        const uintptr_t headerAddress = firstBlock + nameOffset - candidate.StringOffset +
            candidate.HeaderOffset;
        if (!Detail::ReadU16(reinterpret_cast<const void*>(headerAddress), bytePropertyHeader))
            continue;

        uint32_t lengthShift = 0;
        for (lengthShift = 1; lengthShift < 16; lengthShift++)
        {
            if ((bytePropertyHeader >> lengthShift) == 12)
                break;
        }
        if (lengthShift >= 16)
            continue;

        uint16_t noneHeader = 0;
        if (!Detail::ReadU16(reinterpret_cast<const void*>(firstBlock + candidate.HeaderOffset),
                             noneHeader) ||
            (noneHeader >> lengthShift) != 4)
            continue;

        if ((!Detail::HasBytes(bytes, 0x1000, "ByteProperty", 12) &&
             !Detail::HasWideBytes(bytes, 0x1000, "ByteProperty", 12)) ||
            (!Detail::HasBytes(bytes, 0x1000, "CoreUObject", 11) &&
             !Detail::HasWideBytes(bytes, 0x1000, "CoreUObject", 11)))
            continue;

        output = candidate;
        output.PoolAddress = poolAddress;
        output.LengthShift = lengthShift;
        return true;
    }

    return false;
}

inline uintptr_t FindPoolInModule()
{
    auto* module = reinterpret_cast<uint8_t*>(GetModuleHandleA(nullptr));
    if (!module)
        return 0;

    auto* nt = reinterpret_cast<IMAGE_NT_HEADERS*>(module +
        reinterpret_cast<IMAGE_DOS_HEADER*>(module)->e_lfanew);
    auto* sections = IMAGE_FIRST_SECTION(nt);
    const uintptr_t moduleBase = reinterpret_cast<uintptr_t>(module);
    const uintptr_t moduleEnd = moduleBase + nt->OptionalHeader.SizeOfImage;

    for (int i = 0; i < nt->FileHeader.NumberOfSections; i++)
    {
        if (!(sections[i].Characteristics & IMAGE_SCN_MEM_EXECUTE) ||
            !(sections[i].Characteristics & IMAGE_SCN_MEM_READ))
            continue;

        const uintptr_t sectionBase = moduleBase + sections[i].VirtualAddress;
        const size_t sectionSize = sections[i].Misc.VirtualSize;
        for (size_t offset = 0; offset + 12 <= sectionSize; offset++)
        {
            const uintptr_t instruction = sectionBase + offset;
            uint8_t bytes[8]{};
            if (!Detail::ReadBytes(reinterpret_cast<const void*>(instruction), bytes, sizeof(bytes)) ||
                bytes[0] != 0x48 || bytes[1] != 0x8D ||
                (bytes[2] & 0xC7) != 0x05 || bytes[7] != 0xE8)
                continue;

            int32_t poolDisplacement = 0;
            if (!Detail::ReadBytes(reinterpret_cast<const void*>(instruction + 3),
                                    &poolDisplacement, sizeof(poolDisplacement)))
                continue;

            int32_t constructorDisplacement = 0;
            if (!Detail::ReadBytes(reinterpret_cast<const void*>(instruction + 8),
                                    &constructorDisplacement, sizeof(constructorDisplacement)))
                continue;

            const uintptr_t constructor = instruction + 12 + constructorDisplacement;
            bool constructorIsExecutable = false;
            for (int sectionIndex = 0; sectionIndex < nt->FileHeader.NumberOfSections;
                 sectionIndex++)
            {
                if (!(sections[sectionIndex].Characteristics & IMAGE_SCN_MEM_EXECUTE))
                    continue;

                const uintptr_t begin = moduleBase + sections[sectionIndex].VirtualAddress;
                const uintptr_t end = begin + sections[sectionIndex].Misc.VirtualSize;
                if (constructor >= begin && constructor < end)
                {
                    constructorIsExecutable = true;
                    break;
                }
            }
            if (!constructorIsExecutable)
                continue;

            const uintptr_t poolAddress = instruction + 7 + poolDisplacement;
            if (poolAddress < moduleBase || poolAddress >= moduleEnd)
                continue;

            Layout layout{};
            if (FindLayout(poolAddress, layout))
                return poolAddress;
        }
    }
    return 0;
}

inline bool Configure(const Layout& layout, uint32_t blockOffsetBits);
inline bool GetString(int32_t comparisonIndex, uint32_t number, std::string& output);

inline bool Initialize(uintptr_t gobjectsAddress,
                       void (*log)(const char*, ...) = nullptr)
{
    Detail::Initialized = false;

    const uintptr_t poolAddress = FindPoolInModule();
    if (!poolAddress || !gobjectsAddress)
        return false;

    Layout layout{};
    if (!FindLayout(poolAddress, layout))
        return false;

    auto scoreLayout = [&](uint32_t blockOffsetBits) -> int
    {
        if (!Configure(layout, blockOffsetBits))
            return -1;

        std::string none;
        if (!GetString(0, 0, none) || none != "None")
            return -1;

        bool foundByteProperty = false;
        bool foundCoreUObject = false;
        for (int32_t index = 0; index < 0x1000 &&
             (!foundByteProperty || !foundCoreUObject); index++)
        {
            std::string name;
            if (!GetString(index, 0, name))
                continue;
            foundByteProperty = foundByteProperty || name == "ByteProperty";
            foundCoreUObject = foundCoreUObject ||
                name == "CoreUObject" || name == "/Script/CoreUObject";
        }
        if (!foundByteProperty || !foundCoreUObject)
            return -1;

        uintptr_t objectChunks = 0;
        uint32_t objectCount = 0;
        uint32_t objectChunkCount = 0;
        uint32_t currentBlock = 0;
        if (!Detail::ReadPointer(reinterpret_cast<const void*>(gobjectsAddress), objectChunks) ||
            !Detail::ReadU32(reinterpret_cast<const void*>(gobjectsAddress + 0x14), objectCount) ||
            !Detail::ReadU32(reinterpret_cast<const void*>(gobjectsAddress + 0x1C), objectChunkCount) ||
            !Detail::ReadU32(reinterpret_cast<const void*>(layout.PoolAddress + 0x8), currentBlock) ||
            !objectChunks || objectCount == 0 || objectCount > 0x400000 ||
            objectChunkCount == 0 || objectChunkCount > 0x10000 || currentBlock > 0x10000)
            return -1;

        int score = 0;
        int blockMatches = 0;

        const auto inspectObject = [&](uint32_t objectIndex)
        {
            const uint32_t chunkIndex = objectIndex / 0x10000;
            const uint32_t inChunkIndex = objectIndex % 0x10000;
            if (chunkIndex >= objectChunkCount)
                return;

            uintptr_t chunk = 0;
            if (!Detail::ReadPointer(reinterpret_cast<const void*>(objectChunks +
                static_cast<uintptr_t>(chunkIndex) * sizeof(uintptr_t)), chunk) || !chunk)
                return;

            uintptr_t object = 0;
            if (!Detail::ReadPointer(reinterpret_cast<const void*>(chunk +
                static_cast<uintptr_t>(inChunkIndex) * 0x18), object) ||
                !object || object < 0x10000)
                return;

            uint32_t comparisonIndex = 0;
            uint32_t number = 0;
            if (!Detail::ReadU32(reinterpret_cast<const void*>(object + 0x18), comparisonIndex) ||
                !Detail::ReadU32(reinterpret_cast<const void*>(object + 0x20), number))
                return;

            if (comparisonIndex > INT32_MAX)
                return;

            if ((comparisonIndex >> blockOffsetBits) == currentBlock)
                blockMatches++;

            std::string name;
            if (GetString(static_cast<int32_t>(comparisonIndex), number, name) &&
                Detail::IsPlausibleString(name))
                score++;
        };

        const uint32_t firstSampleCount = (objectCount < 256) ? objectCount : 256;
        for (uint32_t index = 1; index < firstSampleCount; index++)
            inspectObject(index);

        const uint32_t tailSampleCount = (objectCount < 4096) ? objectCount : 4096;
        const uint32_t tailStart = objectCount - tailSampleCount;
        for (uint32_t index = tailStart; index < objectCount; index++)
            inspectObject(index);

        if (blockMatches == 0)
            return -1;

        score += blockMatches * 4;
        return score;
    };

    int bestScore = -1;
    uint32_t bestBits = 0;
    constexpr uint32_t candidates[] = { 14, 16, 15, 13, 17, 18, 12, 19, 20 };
    for (uint32_t bits : candidates)
    {
        const int score = scoreLayout(bits);
        if (score > bestScore)
        {
            bestScore = score;
            bestBits = bits;
        }
    }

    if (bestScore < 8 || !Configure(layout, bestBits))
    {
        Detail::Initialized = false;
        if (log)
            log("  [Resolver] FNamePool validation failed (best score=%d)", bestScore);
        return false;
    }

    if (log)
        log("  [Resolver] FNamePool resolved -> 0x%p (BlockOffsetBits=0x%X, score=%d)",
            reinterpret_cast<void*>(poolAddress), bestBits, bestScore);
    return true;
}

inline bool Configure(const Layout& layout, uint32_t blockOffsetBits)
{
    if (!layout.PoolAddress || blockOffsetBits < 1 || blockOffsetBits > 20)
        return false;

    Layout configured = layout;
    configured.BlockOffsetBits = blockOffsetBits;
    Detail::CurrentLayout = configured;
    Detail::Initialized = true;
    return true;
}

inline bool IsInitialized()
{
    return Detail::Initialized;
}

inline uintptr_t GetPoolAddress()
{
    return Detail::Initialized ? Detail::CurrentLayout.PoolAddress : 0;
}

inline uint32_t GetBlockOffsetBits()
{
    return Detail::CurrentLayout.BlockOffsetBits;
}

inline bool GetString(int32_t comparisonIndex, uint32_t number, std::string& output)
{
    output.clear();
    if (comparisonIndex < 0 || !Detail::Initialized)
        return false;

    return Detail::DecodeEntry(static_cast<uint32_t>(comparisonIndex), number, output, 0);
}

} // namespace SDK::NamePool
