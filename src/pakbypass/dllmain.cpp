// dllmain.cpp - WuWa Indonesia Pak Loader (winhttp.dll proxy)
//
// Mounts translation .pak files and removes SHA1 checks using the game's SDK.
// Place as "winhttp.dll" next to the game exe, put .pak files in "wuwaIndonesia" folder.

#include "pch.h"

#include "Logger.hpp"
#include "WinhttpProxy.hpp"
#include "SDK/Basic.hpp"
#include "SDK/CoreUObject_structs.hpp"
#include "SDK/CoreUObject_classes.hpp"
#include "SDK/CoreUObject_functions.cpp"
#include "SDK/Engine_structs.hpp"
#include "SDK/Engine_classes.hpp"
#include "SDK/Engine_parameters.hpp"
#include "SDK/KuroHotPatch_structs.hpp"
#include "SDK/KuroHotPatch_classes.hpp"
#include "SDK/KuroHotPatch_parameters.hpp"
#include "SDK/KuroHotPatch_functions.cpp"
#include "SDK/Basic.cpp"
#include "DynamicResolver.hpp"

#include <exception>

namespace SDK
{
    class FName UKismetStringLibrary::Conv_StringToName(const class FString& InString)
    {
        static class UFunction* Func = nullptr;
        if (Func == nullptr)
            Func = StaticClass()->GetFunction("KismetStringLibrary", "Conv_StringToName");
        Params::KismetStringLibrary_Conv_StringToName Parms{};
        Parms.InString = std::move(InString);
        auto Flgs = Func->FunctionFlags;
        Func->FunctionFlags |= 0x400;
        GetDefaultObj()->ProcessEvent(Func, &Parms);
        Func->FunctionFlags = Flgs;
        return Parms.ReturnValue;
    }
}

namespace fs = std::filesystem;

static bool CheckMountPak()
{
    __try
    {
        SDK::UFunction* Func = SDK::UKuroPakMountStatic::StaticClass()->GetFunction("KuroPakMountStatic", "MountPak");
        return Func != nullptr;
    }
    __except (EXCEPTION_EXECUTE_HANDLER) { return false; }
}

static bool ProcessPakFiles(const std::string& folderPath)
{
    if (!fs::exists(folderPath) || !fs::is_directory(folderPath))
    {
        LOG_WARN("Pak", "Folder khong ton tai: %s", folderPath.c_str());
        return false;
    }

    int order = 46;
    bool found = false;

    Sleep(3000);

    for (const auto& entry : fs::directory_iterator(folderPath))
    {
        if (entry.is_regular_file() && entry.path().extension() == ".pak")
        {
            found = true;
            std::wstring wpath = entry.path().wstring();

            SDK::UKuroPakMountStatic::MountPak(wpath.c_str(), order);
            SDK::UKuroPakMountStatic::RemoveSha1Check(wpath.c_str());

            LOG_INFO("Pak", "Loaded: %ls", wpath.c_str());
            order++;
        }
    }

    return found;
}

static std::string GetDllDirectory(HMODULE hModule)
{
    char buffer[MAX_PATH];
    GetModuleFileNameA(hModule, buffer, MAX_PATH);
    return fs::path(buffer).parent_path().string();
}

using InitializeExporterFromLoaderFn = BOOL (WINAPI*) (
    uintptr_t gobjectsAddress,
    uintptr_t namePoolAddress,
    uint32_t namePoolBlockOffsetBits,
    uint32_t namePoolHeaderOffset,
    uint32_t namePoolStringOffset,
    uint32_t namePoolEntryStride,
    uint32_t namePoolLengthShift,
    uintptr_t appendStringAddress,
    int32_t processEventIdx,
    int32_t processEventRva);

static bool InitializeExporterFromLoader(HMODULE exporter)
{
    auto initialize = reinterpret_cast<InitializeExporterFromLoaderFn>(
        GetProcAddress(exporter, "WuwaIDInitializeFromLoader"));
    if (!initialize)
    {
        LOG_ERROR("Init", "Exporter does not expose loader handoff (error: %lu)",
            GetLastError());
        return false;
    }

    const SDK::NamePool::Layout namePool = SDK::NamePool::GetLayout();
    const uintptr_t gobjectsAddress = reinterpret_cast<uintptr_t>(
        SDK::UObject::GObjects.GetTypedPtr());
    const uintptr_t appendStringAddress = reinterpret_cast<uintptr_t>(
        SDK::FName::AppendString);

    const BOOL initialized = initialize(
        gobjectsAddress,
        namePool.PoolAddress,
        namePool.BlockOffsetBits,
        namePool.HeaderOffset,
        namePool.StringOffset,
        namePool.EntryStride,
        namePool.LengthShift,
        appendStringAddress,
        SDK::Offsets::ProcessEventIdx,
        SDK::Offsets::ProcessEvent);

    LOG_INFO("Init", "Exporter loader handoff: %s", initialized ? "accepted" : "rejected");
    return initialized == TRUE;
}

// Logging adapter for DynamicResolver
static void ResolverLog(const char* fmt, ...)
{
    char buf[2048];
    va_list args;
    va_start(args, fmt);
    vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);
    LOG_INFO("Resolver", "%s", buf);
}

// Global module handle — avoids passing through thread params
static HMODULE g_hModule = nullptr;

static void DoInit()
{
    if (!Logger::Instance().Initialize())
        OutputDebugStringA("[WuwaID] Failed to initialize pakbypass logger\n");

    LOG_INFO("Init", "Log file: %s", Logger::Instance().GetLogPath().c_str());
    LOG_INFO("Init", "Dang cho game khoi tao...");
    LOG_INFO("Init", "Loader module: %p", g_hModule);
    LOG_INFO("Init", "Real winhttp.dll: %s (%p)",
        WinhttpProxy::g_realDll ? "loaded" : "not loaded",
        WinhttpProxy::g_realDll);

    // Phase 1: Dynamically resolve SDK offsets (GObjects, FNamePool,
    // AppendString fallback, ProcessEventIdx).
    // Uses Dumper-7 strategies plus direct name-pool validation.
    if (!DynamicResolver::ResolveAndInitSDK(120, ResolverLog, SDK::UObject::GObjects, 2000))
    {
        LOG_ERROR("Init", "Khong the tim offset SDK!");
        return;
    }

    // Phase 2: Wait for KuroPakMountStatic::MountPak to become available
    for (int i = 0; i < 600 && !CheckMountPak(); i++)  // timeout after ~60s
        Sleep(100);

    if (!CheckMountPak())
    {
        LOG_ERROR("Init", "MountPak khong san sang!");
        return;
    }

    LOG_INFO("Init", "Game da san sang!");

    fs::path dllDir = GetDllDirectory(g_hModule);
    LOG_INFO("Init", "DLL directory: %s", dllDir.string().c_str());

    // Load export_localization_db.dll if present
    fs::path locDll = dllDir / "export_localization_db.dll";
    if (fs::exists(locDll))
    {
        LOG_INFO("Init", "Found exporter: %s", locDll.string().c_str());
        HMODULE hLoc = LoadLibraryW(locDll.wstring().c_str());
        if (hLoc)
        {
            InitializeExporterFromLoader(hLoc);
            LOG_INFO("Init", "Loaded: export_localization_db.dll");
        }
        else
        {
            DWORD error = GetLastError();
            LOG_ERROR("Init", "export_localization_db.dll load that bai (error: %lu)", error);
        }
    }
    else
        LOG_WARN("Init", "Khong tim thay exporter: %s", locDll.string().c_str());

    fs::path pakDir = dllDir / "wuwaIndonesia";
    std::string pakPath = pakDir.string();

    if (!fs::exists(pakPath))
    {
        LOG_WARN("Init", "Tao thu muc: %s", pakPath.c_str());
        fs::create_directories(pakPath);
    }

    if (ProcessPakFiles(pakPath))
    {
        LOG_INFO("Done", "Tai thanh cong!");
    }
    else
    {
        LOG_ERROR("Done", "Khong tim thay file .pak trong: %s", pakPath.c_str());
    }

    Logger::Instance().Flush();
}

// Thread pool callback — looks far more legitimate than raw CreateThread
static VOID CALLBACK InitWorker(PTP_CALLBACK_INSTANCE /*Instance*/, PVOID /*Context*/, PTP_WORK /*Work*/)
{
    try
    {
        DoInit();
    }
    catch (const std::exception& error)
    {
        LOG_ERROR("Init", "Unhandled C++ exception: %s", error.what());
    }
    catch (...)
    {
        LOG_ERROR("Init", "Unhandled exception in initialization worker");
    }
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD ul_reason_for_call, LPVOID lpReserved)
{
    switch (ul_reason_for_call)
    {
    case DLL_PROCESS_ATTACH:
        DisableThreadLibraryCalls(hModule);
        g_hModule = hModule;
        if (!WinhttpProxy::LoadRealDll())
        {
            char message[128];
            snprintf(message, sizeof(message),
                "[WuwaID] Failed to load system winhttp.dll (error: %lu)\n",
                GetLastError());
            OutputDebugStringA(message);
        }
        {
            PTP_WORK work = CreateThreadpoolWork(InitWorker, nullptr, nullptr);
            if (work)
            {
                SubmitThreadpoolWork(work);
                CloseThreadpoolWork(work);
            }
            else
                OutputDebugStringA("[WuwaID] Failed to create initialization worker\n");
        }
        break;

    case DLL_PROCESS_DETACH:
        WinhttpProxy::Unload();
        break;
    }

    return TRUE;
}
