#pragma once
// HidProxy.hpp - Proxies the real hid.dll for DLL injection
//
// This DLL is placed in the game directory as "hid.dll" and forwards
// all original hid.dll calls to the real system hid.dll while
// adding our pak bypass functionality.

#include <windows.h>
#include "Logger.hpp"

namespace HidProxy
{
    // Handle to the real hid.dll
    inline HMODULE g_realHidDll = nullptr;

    // Function pointers for all hid.dll exports
    inline FARPROC g_pHidD_FlushQueue = nullptr;
    inline FARPROC g_pHidD_FreePreparsedData = nullptr;
    inline FARPROC g_pHidD_GetAttributes = nullptr;
    inline FARPROC g_pHidD_GetConfiguration = nullptr;
    inline FARPROC g_pHidD_GetFeature = nullptr;
    inline FARPROC g_pHidD_GetHidGuid = nullptr;
    inline FARPROC g_pHidD_GetIndexedString = nullptr;
    inline FARPROC g_pHidD_GetInputReport = nullptr;
    inline FARPROC g_pHidD_GetManufacturerString = nullptr;
    inline FARPROC g_pHidD_GetMsGenreDescriptor = nullptr;
    inline FARPROC g_pHidD_GetNumInputBuffers = nullptr;
    inline FARPROC g_pHidD_GetPhysicalDescriptor = nullptr;
    inline FARPROC g_pHidD_GetPreparsedData = nullptr;
    inline FARPROC g_pHidD_GetProductString = nullptr;
    inline FARPROC g_pHidD_GetSerialNumberString = nullptr;
    inline FARPROC g_pHidD_Hello = nullptr;
    inline FARPROC g_pHidD_SetConfiguration = nullptr;
    inline FARPROC g_pHidD_SetFeature = nullptr;
    inline FARPROC g_pHidD_SetNumInputBuffers = nullptr;
    inline FARPROC g_pHidD_SetOutputReport = nullptr;
    inline FARPROC g_pHidP_GetButtonCaps = nullptr;
    inline FARPROC g_pHidP_GetCaps = nullptr;
    inline FARPROC g_pHidP_GetData = nullptr;
    inline FARPROC g_pHidP_GetExtendedAttributes = nullptr;
    inline FARPROC g_pHidP_GetLinkCollectionNodes = nullptr;
    inline FARPROC g_pHidP_GetScaledUsageValue = nullptr;
    inline FARPROC g_pHidP_GetSpecificButtonCaps = nullptr;
    inline FARPROC g_pHidP_GetSpecificValueCaps = nullptr;
    inline FARPROC g_pHidP_GetUsageValue = nullptr;
    inline FARPROC g_pHidP_GetUsageValueArray = nullptr;
    inline FARPROC g_pHidP_GetUsages = nullptr;
    inline FARPROC g_pHidP_GetUsagesEx = nullptr;
    inline FARPROC g_pHidP_GetValueCaps = nullptr;
    inline FARPROC g_pHidP_InitializeReportForID = nullptr;
    inline FARPROC g_pHidP_MaxDataListLength = nullptr;
    inline FARPROC g_pHidP_MaxUsageListLength = nullptr;
    inline FARPROC g_pHidP_SetData = nullptr;
    inline FARPROC g_pHidP_SetScaledUsageValue = nullptr;
    inline FARPROC g_pHidP_SetUsageValue = nullptr;
    inline FARPROC g_pHidP_SetUsageValueArray = nullptr;
    inline FARPROC g_pHidP_SetUsages = nullptr;
    inline FARPROC g_pHidP_TranslateUsagesToI8042ScanCodes = nullptr;
    inline FARPROC g_pHidP_UnsetUsages = nullptr;
    inline FARPROC g_pHidP_UsageListDifference = nullptr;

    inline bool LoadRealDll()
    {
        wchar_t systemDir[MAX_PATH];
        GetSystemDirectoryW(systemDir, MAX_PATH);

        wchar_t libName[] = { L'\\',L'h',L'i',L'd',L'.',L'd',L'l',L'l',L'\0' };
        std::wstring realPath = std::wstring(systemDir) + libName;

        g_realHidDll = LoadLibraryW(realPath.c_str());
        if (!g_realHidDll)
        {
            return false;
        }

        // Resolve all exports
        g_pHidD_FlushQueue = GetProcAddress(g_realHidDll, "HidD_FlushQueue");
        g_pHidD_FreePreparsedData = GetProcAddress(g_realHidDll, "HidD_FreePreparsedData");
        g_pHidD_GetAttributes = GetProcAddress(g_realHidDll, "HidD_GetAttributes");
        g_pHidD_GetConfiguration = GetProcAddress(g_realHidDll, "HidD_GetConfiguration");
        g_pHidD_GetFeature = GetProcAddress(g_realHidDll, "HidD_GetFeature");
        g_pHidD_GetHidGuid = GetProcAddress(g_realHidDll, "HidD_GetHidGuid");
        g_pHidD_GetIndexedString = GetProcAddress(g_realHidDll, "HidD_GetIndexedString");
        g_pHidD_GetInputReport = GetProcAddress(g_realHidDll, "HidD_GetInputReport");
        g_pHidD_GetManufacturerString = GetProcAddress(g_realHidDll, "HidD_GetManufacturerString");
        g_pHidD_GetMsGenreDescriptor = GetProcAddress(g_realHidDll, "HidD_GetMsGenreDescriptor");
        g_pHidD_GetNumInputBuffers = GetProcAddress(g_realHidDll, "HidD_GetNumInputBuffers");
        g_pHidD_GetPhysicalDescriptor = GetProcAddress(g_realHidDll, "HidD_GetPhysicalDescriptor");
        g_pHidD_GetPreparsedData = GetProcAddress(g_realHidDll, "HidD_GetPreparsedData");
        g_pHidD_GetProductString = GetProcAddress(g_realHidDll, "HidD_GetProductString");
        g_pHidD_GetSerialNumberString = GetProcAddress(g_realHidDll, "HidD_GetSerialNumberString");
        g_pHidD_Hello = GetProcAddress(g_realHidDll, "HidD_Hello");
        g_pHidD_SetConfiguration = GetProcAddress(g_realHidDll, "HidD_SetConfiguration");
        g_pHidD_SetFeature = GetProcAddress(g_realHidDll, "HidD_SetFeature");
        g_pHidD_SetNumInputBuffers = GetProcAddress(g_realHidDll, "HidD_SetNumInputBuffers");
        g_pHidD_SetOutputReport = GetProcAddress(g_realHidDll, "HidD_SetOutputReport");
        g_pHidP_GetButtonCaps = GetProcAddress(g_realHidDll, "HidP_GetButtonCaps");
        g_pHidP_GetCaps = GetProcAddress(g_realHidDll, "HidP_GetCaps");
        g_pHidP_GetData = GetProcAddress(g_realHidDll, "HidP_GetData");
        g_pHidP_GetExtendedAttributes = GetProcAddress(g_realHidDll, "HidP_GetExtendedAttributes");
        g_pHidP_GetLinkCollectionNodes = GetProcAddress(g_realHidDll, "HidP_GetLinkCollectionNodes");
        g_pHidP_GetScaledUsageValue = GetProcAddress(g_realHidDll, "HidP_GetScaledUsageValue");
        g_pHidP_GetSpecificButtonCaps = GetProcAddress(g_realHidDll, "HidP_GetSpecificButtonCaps");
        g_pHidP_GetSpecificValueCaps = GetProcAddress(g_realHidDll, "HidP_GetSpecificValueCaps");
        g_pHidP_GetUsageValue = GetProcAddress(g_realHidDll, "HidP_GetUsageValue");
        g_pHidP_GetUsageValueArray = GetProcAddress(g_realHidDll, "HidP_GetUsageValueArray");
        g_pHidP_GetUsages = GetProcAddress(g_realHidDll, "HidP_GetUsages");
        g_pHidP_GetUsagesEx = GetProcAddress(g_realHidDll, "HidP_GetUsagesEx");
        g_pHidP_GetValueCaps = GetProcAddress(g_realHidDll, "HidP_GetValueCaps");
        g_pHidP_InitializeReportForID = GetProcAddress(g_realHidDll, "HidP_InitializeReportForID");
        g_pHidP_MaxDataListLength = GetProcAddress(g_realHidDll, "HidP_MaxDataListLength");
        g_pHidP_MaxUsageListLength = GetProcAddress(g_realHidDll, "HidP_MaxUsageListLength");
        g_pHidP_SetData = GetProcAddress(g_realHidDll, "HidP_SetData");
        g_pHidP_SetScaledUsageValue = GetProcAddress(g_realHidDll, "HidP_SetScaledUsageValue");
        g_pHidP_SetUsageValue = GetProcAddress(g_realHidDll, "HidP_SetUsageValue");
        g_pHidP_SetUsageValueArray = GetProcAddress(g_realHidDll, "HidP_SetUsageValueArray");
        g_pHidP_SetUsages = GetProcAddress(g_realHidDll, "HidP_SetUsages");
        g_pHidP_TranslateUsagesToI8042ScanCodes = GetProcAddress(g_realHidDll, "HidP_TranslateUsagesToI8042ScanCodes");
        g_pHidP_UnsetUsages = GetProcAddress(g_realHidDll, "HidP_UnsetUsages");
        g_pHidP_UsageListDifference = GetProcAddress(g_realHidDll, "HidP_UsageListDifference");

        return true;
    }

    inline void Unload()
    {
        if (g_realHidDll)
        {
            FreeLibrary(g_realHidDll);
            g_realHidDll = nullptr;
            LOG_INFO("HidProxy", "Real hid.dll unloaded");
        }
    }
}

// Proxy implementations
extern "C"
{
    __declspec(dllexport) BOOL WINAPI Proxy_HidD_FlushQueue(void* a)
    {
        if (HidProxy::g_pHidD_FlushQueue)
            return reinterpret_cast<BOOL(WINAPI*)(void*)>(HidProxy::g_pHidD_FlushQueue)(a);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_HidD_FreePreparsedData(void* a)
    {
        if (HidProxy::g_pHidD_FreePreparsedData)
            return reinterpret_cast<BOOL(WINAPI*)(void*)>(HidProxy::g_pHidD_FreePreparsedData)(a);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_HidD_GetAttributes(void* a, void* b)
    {
        if (HidProxy::g_pHidD_GetAttributes)
            return reinterpret_cast<BOOL(WINAPI*)(void*, void*)>(HidProxy::g_pHidD_GetAttributes)(a, b);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_HidD_GetConfiguration(void* a, void* b, ULONG c)
    {
        if (HidProxy::g_pHidD_GetConfiguration)
            return reinterpret_cast<BOOL(WINAPI*)(void*, void*, ULONG)>(HidProxy::g_pHidD_GetConfiguration)(a, b, c);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_HidD_GetFeature(void* a, void* b, ULONG c)
    {
        if (HidProxy::g_pHidD_GetFeature)
            return reinterpret_cast<BOOL(WINAPI*)(void*, void*, ULONG)>(HidProxy::g_pHidD_GetFeature)(a, b, c);
        return FALSE;
    }

    __declspec(dllexport) void WINAPI Proxy_HidD_GetHidGuid(void* a)
    {
        if (HidProxy::g_pHidD_GetHidGuid)
            reinterpret_cast<void(WINAPI*)(void*)>(HidProxy::g_pHidD_GetHidGuid)(a);
    }

    __declspec(dllexport) BOOL WINAPI Proxy_HidD_GetIndexedString(void* a, ULONG b, void* c, ULONG d)
    {
        if (HidProxy::g_pHidD_GetIndexedString)
            return reinterpret_cast<BOOL(WINAPI*)(void*, ULONG, void*, ULONG)>(HidProxy::g_pHidD_GetIndexedString)(a, b, c, d);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_HidD_GetInputReport(void* a, void* b, ULONG c)
    {
        if (HidProxy::g_pHidD_GetInputReport)
            return reinterpret_cast<BOOL(WINAPI*)(void*, void*, ULONG)>(HidProxy::g_pHidD_GetInputReport)(a, b, c);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_HidD_GetManufacturerString(void* a, void* b, ULONG c)
    {
        if (HidProxy::g_pHidD_GetManufacturerString)
            return reinterpret_cast<BOOL(WINAPI*)(void*, void*, ULONG)>(HidProxy::g_pHidD_GetManufacturerString)(a, b, c);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_HidD_GetMsGenreDescriptor(void* a, void* b, ULONG c)
    {
        if (HidProxy::g_pHidD_GetMsGenreDescriptor)
            return reinterpret_cast<BOOL(WINAPI*)(void*, void*, ULONG)>(HidProxy::g_pHidD_GetMsGenreDescriptor)(a, b, c);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_HidD_GetNumInputBuffers(void* a, void* b)
    {
        if (HidProxy::g_pHidD_GetNumInputBuffers)
            return reinterpret_cast<BOOL(WINAPI*)(void*, void*)>(HidProxy::g_pHidD_GetNumInputBuffers)(a, b);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_HidD_GetPhysicalDescriptor(void* a, void* b, ULONG c)
    {
        if (HidProxy::g_pHidD_GetPhysicalDescriptor)
            return reinterpret_cast<BOOL(WINAPI*)(void*, void*, ULONG)>(HidProxy::g_pHidD_GetPhysicalDescriptor)(a, b, c);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_HidD_GetPreparsedData(void* a, void* b)
    {
        if (HidProxy::g_pHidD_GetPreparsedData)
            return reinterpret_cast<BOOL(WINAPI*)(void*, void*)>(HidProxy::g_pHidD_GetPreparsedData)(a, b);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_HidD_GetProductString(void* a, void* b, ULONG c)
    {
        if (HidProxy::g_pHidD_GetProductString)
            return reinterpret_cast<BOOL(WINAPI*)(void*, void*, ULONG)>(HidProxy::g_pHidD_GetProductString)(a, b, c);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_HidD_GetSerialNumberString(void* a, void* b, ULONG c)
    {
        if (HidProxy::g_pHidD_GetSerialNumberString)
            return reinterpret_cast<BOOL(WINAPI*)(void*, void*, ULONG)>(HidProxy::g_pHidD_GetSerialNumberString)(a, b, c);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_HidD_Hello(void* a, ULONG b)
    {
        if (HidProxy::g_pHidD_Hello)
            return reinterpret_cast<BOOL(WINAPI*)(void*, ULONG)>(HidProxy::g_pHidD_Hello)(a, b);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_HidD_SetConfiguration(void* a, void* b, ULONG c)
    {
        if (HidProxy::g_pHidD_SetConfiguration)
            return reinterpret_cast<BOOL(WINAPI*)(void*, void*, ULONG)>(HidProxy::g_pHidD_SetConfiguration)(a, b, c);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_HidD_SetFeature(void* a, void* b, ULONG c)
    {
        if (HidProxy::g_pHidD_SetFeature)
            return reinterpret_cast<BOOL(WINAPI*)(void*, void*, ULONG)>(HidProxy::g_pHidD_SetFeature)(a, b, c);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_HidD_SetNumInputBuffers(void* a, ULONG b)
    {
        if (HidProxy::g_pHidD_SetNumInputBuffers)
            return reinterpret_cast<BOOL(WINAPI*)(void*, ULONG)>(HidProxy::g_pHidD_SetNumInputBuffers)(a, b);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_HidD_SetOutputReport(void* a, void* b, ULONG c)
    {
        if (HidProxy::g_pHidD_SetOutputReport)
            return reinterpret_cast<BOOL(WINAPI*)(void*, void*, ULONG)>(HidProxy::g_pHidD_SetOutputReport)(a, b, c);
        return FALSE;
    }

    __declspec(dllexport) ULONG WINAPI Proxy_HidP_GetButtonCaps(ULONG a, void* b, void* c, void* d)
    {
        if (HidProxy::g_pHidP_GetButtonCaps)
            return reinterpret_cast<ULONG(WINAPI*)(ULONG, void*, void*, void*)>(HidProxy::g_pHidP_GetButtonCaps)(a, b, c, d);
        return 0;
    }

    __declspec(dllexport) ULONG WINAPI Proxy_HidP_GetCaps(void* a, void* b)
    {
        if (HidProxy::g_pHidP_GetCaps)
            return reinterpret_cast<ULONG(WINAPI*)(void*, void*)>(HidProxy::g_pHidP_GetCaps)(a, b);
        return 0;
    }

    __declspec(dllexport) ULONG WINAPI Proxy_HidP_GetData(ULONG a, void* b, void* c, void* d, void* e, ULONG f)
    {
        if (HidProxy::g_pHidP_GetData)
            return reinterpret_cast<ULONG(WINAPI*)(ULONG, void*, void*, void*, void*, ULONG)>(HidProxy::g_pHidP_GetData)(a, b, c, d, e, f);
        return 0;
    }

    __declspec(dllexport) ULONG WINAPI Proxy_HidP_GetExtendedAttributes(ULONG a, USHORT b, void* c, void* d, void* e)
    {
        if (HidProxy::g_pHidP_GetExtendedAttributes)
            return reinterpret_cast<ULONG(WINAPI*)(ULONG, USHORT, void*, void*, void*)>(HidProxy::g_pHidP_GetExtendedAttributes)(a, b, c, d, e);
        return 0;
    }

    __declspec(dllexport) ULONG WINAPI Proxy_HidP_GetLinkCollectionNodes(void* a, void* b, void* c)
    {
        if (HidProxy::g_pHidP_GetLinkCollectionNodes)
            return reinterpret_cast<ULONG(WINAPI*)(void*, void*, void*)>(HidProxy::g_pHidP_GetLinkCollectionNodes)(a, b, c);
        return 0;
    }

    __declspec(dllexport) ULONG WINAPI Proxy_HidP_GetScaledUsageValue(ULONG a, USHORT b, USHORT c, USHORT d, void* e, void* f, void* g, ULONG h)
    {
        if (HidProxy::g_pHidP_GetScaledUsageValue)
            return reinterpret_cast<ULONG(WINAPI*)(ULONG, USHORT, USHORT, USHORT, void*, void*, void*, ULONG)>(HidProxy::g_pHidP_GetScaledUsageValue)(a, b, c, d, e, f, g, h);
        return 0;
    }

    __declspec(dllexport) ULONG WINAPI Proxy_HidP_GetSpecificButtonCaps(ULONG a, USHORT b, USHORT c, USHORT d, void* e, void* f, void* g)
    {
        if (HidProxy::g_pHidP_GetSpecificButtonCaps)
            return reinterpret_cast<ULONG(WINAPI*)(ULONG, USHORT, USHORT, USHORT, void*, void*, void*)>(HidProxy::g_pHidP_GetSpecificButtonCaps)(a, b, c, d, e, f, g);
        return 0;
    }

    __declspec(dllexport) ULONG WINAPI Proxy_HidP_GetSpecificValueCaps(ULONG a, USHORT b, USHORT c, USHORT d, void* e, void* f, void* g)
    {
        if (HidProxy::g_pHidP_GetSpecificValueCaps)
            return reinterpret_cast<ULONG(WINAPI*)(ULONG, USHORT, USHORT, USHORT, void*, void*, void*)>(HidProxy::g_pHidP_GetSpecificValueCaps)(a, b, c, d, e, f, g);
        return 0;
    }

    __declspec(dllexport) ULONG WINAPI Proxy_HidP_GetUsageValue(ULONG a, USHORT b, USHORT c, USHORT d, void* e, void* f, void* g, ULONG h)
    {
        if (HidProxy::g_pHidP_GetUsageValue)
            return reinterpret_cast<ULONG(WINAPI*)(ULONG, USHORT, USHORT, USHORT, void*, void*, void*, ULONG)>(HidProxy::g_pHidP_GetUsageValue)(a, b, c, d, e, f, g, h);
        return 0;
    }

    __declspec(dllexport) ULONG WINAPI Proxy_HidP_GetUsageValueArray(ULONG a, USHORT b, USHORT c, USHORT d, void* e, USHORT f, void* g, void* h, ULONG i)
    {
        if (HidProxy::g_pHidP_GetUsageValueArray)
            return reinterpret_cast<ULONG(WINAPI*)(ULONG, USHORT, USHORT, USHORT, void*, USHORT, void*, void*, ULONG)>(HidProxy::g_pHidP_GetUsageValueArray)(a, b, c, d, e, f, g, h, i);
        return 0;
    }

    __declspec(dllexport) ULONG WINAPI Proxy_HidP_GetUsages(ULONG a, USHORT b, USHORT c, void* d, void* e, void* f, void* g, ULONG h)
    {
        if (HidProxy::g_pHidP_GetUsages)
            return reinterpret_cast<ULONG(WINAPI*)(ULONG, USHORT, USHORT, void*, void*, void*, void*, ULONG)>(HidProxy::g_pHidP_GetUsages)(a, b, c, d, e, f, g, h);
        return 0;
    }

    __declspec(dllexport) ULONG WINAPI Proxy_HidP_GetUsagesEx(ULONG a, USHORT b, void* c, void* d, void* e, void* f, ULONG g)
    {
        if (HidProxy::g_pHidP_GetUsagesEx)
            return reinterpret_cast<ULONG(WINAPI*)(ULONG, USHORT, void*, void*, void*, void*, ULONG)>(HidProxy::g_pHidP_GetUsagesEx)(a, b, c, d, e, f, g);
        return 0;
    }

    __declspec(dllexport) ULONG WINAPI Proxy_HidP_GetValueCaps(ULONG a, void* b, void* c, void* d)
    {
        if (HidProxy::g_pHidP_GetValueCaps)
            return reinterpret_cast<ULONG(WINAPI*)(ULONG, void*, void*, void*)>(HidProxy::g_pHidP_GetValueCaps)(a, b, c, d);
        return 0;
    }

    __declspec(dllexport) ULONG WINAPI Proxy_HidP_InitializeReportForID(ULONG a, UCHAR b, void* c, void* d, ULONG e)
    {
        if (HidProxy::g_pHidP_InitializeReportForID)
            return reinterpret_cast<ULONG(WINAPI*)(ULONG, UCHAR, void*, void*, ULONG)>(HidProxy::g_pHidP_InitializeReportForID)(a, b, c, d, e);
        return 0;
    }

    __declspec(dllexport) ULONG WINAPI Proxy_HidP_MaxDataListLength(ULONG a, void* b)
    {
        if (HidProxy::g_pHidP_MaxDataListLength)
            return reinterpret_cast<ULONG(WINAPI*)(ULONG, void*)>(HidProxy::g_pHidP_MaxDataListLength)(a, b);
        return 0;
    }

    __declspec(dllexport) ULONG WINAPI Proxy_HidP_MaxUsageListLength(ULONG a, USHORT b, void* c)
    {
        if (HidProxy::g_pHidP_MaxUsageListLength)
            return reinterpret_cast<ULONG(WINAPI*)(ULONG, USHORT, void*)>(HidProxy::g_pHidP_MaxUsageListLength)(a, b, c);
        return 0;
    }

    __declspec(dllexport) ULONG WINAPI Proxy_HidP_SetData(ULONG a, void* b, void* c, void* d, void* e, ULONG f)
    {
        if (HidProxy::g_pHidP_SetData)
            return reinterpret_cast<ULONG(WINAPI*)(ULONG, void*, void*, void*, void*, ULONG)>(HidProxy::g_pHidP_SetData)(a, b, c, d, e, f);
        return 0;
    }

    __declspec(dllexport) ULONG WINAPI Proxy_HidP_SetScaledUsageValue(ULONG a, USHORT b, USHORT c, USHORT d, LONG e, void* f, void* g, ULONG h)
    {
        if (HidProxy::g_pHidP_SetScaledUsageValue)
            return reinterpret_cast<ULONG(WINAPI*)(ULONG, USHORT, USHORT, USHORT, LONG, void*, void*, ULONG)>(HidProxy::g_pHidP_SetScaledUsageValue)(a, b, c, d, e, f, g, h);
        return 0;
    }

    __declspec(dllexport) ULONG WINAPI Proxy_HidP_SetUsageValue(ULONG a, USHORT b, USHORT c, USHORT d, ULONG e, void* f, void* g, ULONG h)
    {
        if (HidProxy::g_pHidP_SetUsageValue)
            return reinterpret_cast<ULONG(WINAPI*)(ULONG, USHORT, USHORT, USHORT, ULONG, void*, void*, ULONG)>(HidProxy::g_pHidP_SetUsageValue)(a, b, c, d, e, f, g, h);
        return 0;
    }

    __declspec(dllexport) ULONG WINAPI Proxy_HidP_SetUsageValueArray(ULONG a, USHORT b, USHORT c, USHORT d, void* e, USHORT f, void* g, void* h, ULONG i)
    {
        if (HidProxy::g_pHidP_SetUsageValueArray)
            return reinterpret_cast<ULONG(WINAPI*)(ULONG, USHORT, USHORT, USHORT, void*, USHORT, void*, void*, ULONG)>(HidProxy::g_pHidP_SetUsageValueArray)(a, b, c, d, e, f, g, h, i);
        return 0;
    }

    __declspec(dllexport) ULONG WINAPI Proxy_HidP_SetUsages(ULONG a, USHORT b, USHORT c, void* d, void* e, void* f, void* g, ULONG h)
    {
        if (HidProxy::g_pHidP_SetUsages)
            return reinterpret_cast<ULONG(WINAPI*)(ULONG, USHORT, USHORT, void*, void*, void*, void*, ULONG)>(HidProxy::g_pHidP_SetUsages)(a, b, c, d, e, f, g, h);
        return 0;
    }

    __declspec(dllexport) ULONG WINAPI Proxy_HidP_TranslateUsagesToI8042ScanCodes(void* a, ULONG b, ULONG c, void* d, void* e, void* f)
    {
        if (HidProxy::g_pHidP_TranslateUsagesToI8042ScanCodes)
            return reinterpret_cast<ULONG(WINAPI*)(void*, ULONG, ULONG, void*, void*, void*)>(HidProxy::g_pHidP_TranslateUsagesToI8042ScanCodes)(a, b, c, d, e, f);
        return 0;
    }

    __declspec(dllexport) ULONG WINAPI Proxy_HidP_UnsetUsages(ULONG a, USHORT b, USHORT c, void* d, void* e, void* f, void* g, ULONG h)
    {
        if (HidProxy::g_pHidP_UnsetUsages)
            return reinterpret_cast<ULONG(WINAPI*)(ULONG, USHORT, USHORT, void*, void*, void*, void*, ULONG)>(HidProxy::g_pHidP_UnsetUsages)(a, b, c, d, e, f, g, h);
        return 0;
    }

    __declspec(dllexport) ULONG WINAPI Proxy_HidP_UsageListDifference(void* a, void* b, void* c, void* d, ULONG e)
    {
        if (HidProxy::g_pHidP_UsageListDifference)
            return reinterpret_cast<ULONG(WINAPI*)(void*, void*, void*, void*, ULONG)>(HidProxy::g_pHidP_UsageListDifference)(a, b, c, d, e);
        return 0;
    }
}
