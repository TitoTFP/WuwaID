#pragma once
// WinhttpProxy.hpp - Proxies the real winhttp.dll for DLL injection
//
// This DLL is placed in the game directory as "winhttp.dll" and forwards
// all original winhttp.dll calls to the real system winhttp.dll while
// adding our pak bypass functionality.

#include <windows.h>
#include <string>
#include "Logger.hpp"

// Minimal type definitions (avoid including winhttp.h to prevent auto-linking)
typedef PVOID  HINTERNET;
typedef WORD   INTERNET_PORT;

namespace WinhttpProxy
{
    inline HMODULE g_realDll = nullptr;

    inline FARPROC g_WinHttpAddRequestHeaders               = nullptr;
    inline FARPROC g_WinHttpAddRequestHeadersEx             = nullptr;
    inline FARPROC g_WinHttpCheckPlatform                   = nullptr;
    inline FARPROC g_WinHttpCloseHandle                     = nullptr;
    inline FARPROC g_WinHttpConnect                         = nullptr;
    inline FARPROC g_WinHttpCrackUrl                        = nullptr;
    inline FARPROC g_WinHttpCreateProxyResolver             = nullptr;
    inline FARPROC g_WinHttpCreateUrl                       = nullptr;
    inline FARPROC g_WinHttpDetectAutoProxyConfigUrl         = nullptr;
    inline FARPROC g_WinHttpFreeProxyList                   = nullptr;
    inline FARPROC g_WinHttpFreeProxyResult                 = nullptr;
    inline FARPROC g_WinHttpFreeProxyResultEx               = nullptr;
    inline FARPROC g_WinHttpFreeQueryConnectionGroupResult   = nullptr;
    inline FARPROC g_WinHttpGetDefaultProxyConfiguration    = nullptr;
    inline FARPROC g_WinHttpGetIEProxyConfigForCurrentUser  = nullptr;
    inline FARPROC g_WinHttpGetProxyForUrl                  = nullptr;
    inline FARPROC g_WinHttpGetProxyForUrlEx                = nullptr;
    inline FARPROC g_WinHttpGetProxyForUrlEx2               = nullptr;
    inline FARPROC g_WinHttpGetProxyResult                  = nullptr;
    inline FARPROC g_WinHttpGetProxyResultEx                = nullptr;
    inline FARPROC g_WinHttpGetProxySettings                = nullptr;
    inline FARPROC g_WinHttpGetProxySettingsResultEx        = nullptr;
    inline FARPROC g_WinHttpGetProxySettingsVersion         = nullptr;
    inline FARPROC g_WinHttpGetTunnelSocket                 = nullptr;
    inline FARPROC g_WinHttpOpen                            = nullptr;
    inline FARPROC g_WinHttpOpenRequest                     = nullptr;
    inline FARPROC g_WinHttpProbeConnectivity               = nullptr;
    inline FARPROC g_WinHttpQueryAuthSchemes                = nullptr;
    inline FARPROC g_WinHttpQueryConnectionGroup            = nullptr;
    inline FARPROC g_WinHttpQueryDataAvailable              = nullptr;
    inline FARPROC g_WinHttpQueryHeaders                    = nullptr;
    inline FARPROC g_WinHttpQueryHeadersEx                  = nullptr;
    inline FARPROC g_WinHttpQueryOption                     = nullptr;
    inline FARPROC g_WinHttpReadData                        = nullptr;
    inline FARPROC g_WinHttpReadDataEx                      = nullptr;
    inline FARPROC g_WinHttpReceiveResponse                 = nullptr;
    inline FARPROC g_WinHttpRegisterProxyChangeNotification = nullptr;
    inline FARPROC g_WinHttpResetAutoProxy                  = nullptr;
    inline FARPROC g_WinHttpSendRequest                     = nullptr;
    inline FARPROC g_WinHttpSetCredentials                  = nullptr;
    inline FARPROC g_WinHttpSetDefaultProxyConfiguration    = nullptr;
    inline FARPROC g_WinHttpSetOption                       = nullptr;
    inline FARPROC g_WinHttpSetProxySettings                = nullptr;
    inline FARPROC g_WinHttpSetStatusCallback               = nullptr;
    inline FARPROC g_WinHttpSetTimeouts                     = nullptr;
    inline FARPROC g_WinHttpTimeFromSystemTime              = nullptr;
    inline FARPROC g_WinHttpTimeToSystemTime                = nullptr;
    inline FARPROC g_WinHttpUnregisterProxyChangeNotification = nullptr;
    inline FARPROC g_WinHttpWebSocketClose                  = nullptr;
    inline FARPROC g_WinHttpWebSocketCompleteUpgrade        = nullptr;
    inline FARPROC g_WinHttpWebSocketQueryCloseStatus       = nullptr;
    inline FARPROC g_WinHttpWebSocketReceive                = nullptr;
    inline FARPROC g_WinHttpWebSocketSend                   = nullptr;
    inline FARPROC g_WinHttpWebSocketShutdown               = nullptr;
    inline FARPROC g_WinHttpWriteData                       = nullptr;

    inline bool LoadRealDll()
    {
        wchar_t systemDir[MAX_PATH];
        GetSystemDirectoryW(systemDir, MAX_PATH);
        wchar_t libName[] = { L'\\',L'w',L'i',L'n',L'h',L't',L't',L'p',L'.',L'd',L'l',L'l',L'\0' };
        std::wstring realPath = std::wstring(systemDir) + libName;

        g_realDll = LoadLibraryW(realPath.c_str());
        if (!g_realDll)
            return false;

#define WHTTP_RESOLVE(fn) g_ ## fn = GetProcAddress(g_realDll, #fn)
        WHTTP_RESOLVE(WinHttpAddRequestHeaders);
        WHTTP_RESOLVE(WinHttpAddRequestHeadersEx);
        WHTTP_RESOLVE(WinHttpCheckPlatform);
        WHTTP_RESOLVE(WinHttpCloseHandle);
        WHTTP_RESOLVE(WinHttpConnect);
        WHTTP_RESOLVE(WinHttpCrackUrl);
        WHTTP_RESOLVE(WinHttpCreateProxyResolver);
        WHTTP_RESOLVE(WinHttpCreateUrl);
        WHTTP_RESOLVE(WinHttpDetectAutoProxyConfigUrl);
        WHTTP_RESOLVE(WinHttpFreeProxyList);
        WHTTP_RESOLVE(WinHttpFreeProxyResult);
        WHTTP_RESOLVE(WinHttpFreeProxyResultEx);
        WHTTP_RESOLVE(WinHttpFreeQueryConnectionGroupResult);
        WHTTP_RESOLVE(WinHttpGetDefaultProxyConfiguration);
        WHTTP_RESOLVE(WinHttpGetIEProxyConfigForCurrentUser);
        WHTTP_RESOLVE(WinHttpGetProxyForUrl);
        WHTTP_RESOLVE(WinHttpGetProxyForUrlEx);
        WHTTP_RESOLVE(WinHttpGetProxyForUrlEx2);
        WHTTP_RESOLVE(WinHttpGetProxyResult);
        WHTTP_RESOLVE(WinHttpGetProxyResultEx);
        WHTTP_RESOLVE(WinHttpGetProxySettings);
        WHTTP_RESOLVE(WinHttpGetProxySettingsResultEx);
        WHTTP_RESOLVE(WinHttpGetProxySettingsVersion);
        WHTTP_RESOLVE(WinHttpGetTunnelSocket);
        WHTTP_RESOLVE(WinHttpOpen);
        WHTTP_RESOLVE(WinHttpOpenRequest);
        WHTTP_RESOLVE(WinHttpProbeConnectivity);
        WHTTP_RESOLVE(WinHttpQueryAuthSchemes);
        WHTTP_RESOLVE(WinHttpQueryConnectionGroup);
        WHTTP_RESOLVE(WinHttpQueryDataAvailable);
        WHTTP_RESOLVE(WinHttpQueryHeaders);
        WHTTP_RESOLVE(WinHttpQueryHeadersEx);
        WHTTP_RESOLVE(WinHttpQueryOption);
        WHTTP_RESOLVE(WinHttpReadData);
        WHTTP_RESOLVE(WinHttpReadDataEx);
        WHTTP_RESOLVE(WinHttpReceiveResponse);
        WHTTP_RESOLVE(WinHttpRegisterProxyChangeNotification);
        WHTTP_RESOLVE(WinHttpResetAutoProxy);
        WHTTP_RESOLVE(WinHttpSendRequest);
        WHTTP_RESOLVE(WinHttpSetCredentials);
        WHTTP_RESOLVE(WinHttpSetDefaultProxyConfiguration);
        WHTTP_RESOLVE(WinHttpSetOption);
        WHTTP_RESOLVE(WinHttpSetProxySettings);
        WHTTP_RESOLVE(WinHttpSetStatusCallback);
        WHTTP_RESOLVE(WinHttpSetTimeouts);
        WHTTP_RESOLVE(WinHttpTimeFromSystemTime);
        WHTTP_RESOLVE(WinHttpTimeToSystemTime);
        WHTTP_RESOLVE(WinHttpUnregisterProxyChangeNotification);
        WHTTP_RESOLVE(WinHttpWebSocketClose);
        WHTTP_RESOLVE(WinHttpWebSocketCompleteUpgrade);
        WHTTP_RESOLVE(WinHttpWebSocketQueryCloseStatus);
        WHTTP_RESOLVE(WinHttpWebSocketReceive);
        WHTTP_RESOLVE(WinHttpWebSocketSend);
        WHTTP_RESOLVE(WinHttpWebSocketShutdown);
        WHTTP_RESOLVE(WinHttpWriteData);
#undef WHTTP_RESOLVE

        return true;
    }

    inline void Unload()
    {
        if (g_realDll)
        {
            FreeLibrary(g_realDll);
            g_realDll = nullptr;
            LOG_INFO("WinhttpProxy", "Real winhttp.dll unloaded");
        }
    }
}

// ============================================================================
// Exported proxy functions — forward every call to the real winhttp.dll
// ============================================================================

extern "C"
{
    __declspec(dllexport) BOOL WINAPI Proxy_WinHttpAddRequestHeaders(HINTERNET hRequest, LPCWSTR lpszHeaders, DWORD dwHeadersLength, DWORD dwModifiers)
    {
        if (WinhttpProxy::g_WinHttpAddRequestHeaders)
            return reinterpret_cast<BOOL(WINAPI*)(HINTERNET, LPCWSTR, DWORD, DWORD)>(WinhttpProxy::g_WinHttpAddRequestHeaders)(hRequest, lpszHeaders, dwHeadersLength, dwModifiers);
        return FALSE;
    }

    __declspec(dllexport) DWORD WINAPI Proxy_WinHttpAddRequestHeadersEx(HINTERNET hRequest, DWORD dwModifiers, ULONGLONG ullFlags, ULONGLONG ullExtra, DWORD cHeaders, LPVOID pHeaders)
    {
        if (WinhttpProxy::g_WinHttpAddRequestHeadersEx)
            return reinterpret_cast<DWORD(WINAPI*)(HINTERNET, DWORD, ULONGLONG, ULONGLONG, DWORD, LPVOID)>(WinhttpProxy::g_WinHttpAddRequestHeadersEx)(hRequest, dwModifiers, ullFlags, ullExtra, cHeaders, pHeaders);
        return ERROR_NOT_SUPPORTED;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_WinHttpCheckPlatform(void)
    {
        if (WinhttpProxy::g_WinHttpCheckPlatform)
            return reinterpret_cast<BOOL(WINAPI*)()>(WinhttpProxy::g_WinHttpCheckPlatform)();
        return TRUE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_WinHttpCloseHandle(HINTERNET hInternet)
    {
        if (WinhttpProxy::g_WinHttpCloseHandle)
            return reinterpret_cast<BOOL(WINAPI*)(HINTERNET)>(WinhttpProxy::g_WinHttpCloseHandle)(hInternet);
        return FALSE;
    }

    __declspec(dllexport) HINTERNET WINAPI Proxy_WinHttpConnect(HINTERNET hSession, LPCWSTR pswzServerName, INTERNET_PORT nServerPort, DWORD dwReserved)
    {
        if (WinhttpProxy::g_WinHttpConnect)
            return reinterpret_cast<HINTERNET(WINAPI*)(HINTERNET, LPCWSTR, INTERNET_PORT, DWORD)>(WinhttpProxy::g_WinHttpConnect)(hSession, pswzServerName, nServerPort, dwReserved);
        return nullptr;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_WinHttpCrackUrl(LPCWSTR pwszUrl, DWORD dwUrlLength, DWORD dwFlags, LPVOID lpUrlComponents)
    {
        if (WinhttpProxy::g_WinHttpCrackUrl)
            return reinterpret_cast<BOOL(WINAPI*)(LPCWSTR, DWORD, DWORD, LPVOID)>(WinhttpProxy::g_WinHttpCrackUrl)(pwszUrl, dwUrlLength, dwFlags, lpUrlComponents);
        return FALSE;
    }

    __declspec(dllexport) DWORD WINAPI Proxy_WinHttpCreateProxyResolver(HINTERNET hSession, HINTERNET* phResolver)
    {
        if (WinhttpProxy::g_WinHttpCreateProxyResolver)
            return reinterpret_cast<DWORD(WINAPI*)(HINTERNET, HINTERNET*)>(WinhttpProxy::g_WinHttpCreateProxyResolver)(hSession, phResolver);
        return ERROR_NOT_SUPPORTED;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_WinHttpCreateUrl(LPVOID lpUrlComponents, DWORD dwFlags, LPWSTR pwszUrl, LPDWORD lpdwUrlLength)
    {
        if (WinhttpProxy::g_WinHttpCreateUrl)
            return reinterpret_cast<BOOL(WINAPI*)(LPVOID, DWORD, LPWSTR, LPDWORD)>(WinhttpProxy::g_WinHttpCreateUrl)(lpUrlComponents, dwFlags, pwszUrl, lpdwUrlLength);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_WinHttpDetectAutoProxyConfigUrl(DWORD dwAutoDetectFlags, LPWSTR* ppwszAutoConfigUrl)
    {
        if (WinhttpProxy::g_WinHttpDetectAutoProxyConfigUrl)
            return reinterpret_cast<BOOL(WINAPI*)(DWORD, LPWSTR*)>(WinhttpProxy::g_WinHttpDetectAutoProxyConfigUrl)(dwAutoDetectFlags, ppwszAutoConfigUrl);
        return FALSE;
    }

    __declspec(dllexport) void WINAPI Proxy_WinHttpFreeProxyList(LPVOID pProxyList)
    {
        if (WinhttpProxy::g_WinHttpFreeProxyList)
            reinterpret_cast<void(WINAPI*)(LPVOID)>(WinhttpProxy::g_WinHttpFreeProxyList)(pProxyList);
    }

    __declspec(dllexport) void WINAPI Proxy_WinHttpFreeProxyResult(LPVOID pProxyResult)
    {
        if (WinhttpProxy::g_WinHttpFreeProxyResult)
            reinterpret_cast<void(WINAPI*)(LPVOID)>(WinhttpProxy::g_WinHttpFreeProxyResult)(pProxyResult);
    }

    __declspec(dllexport) void WINAPI Proxy_WinHttpFreeProxyResultEx(LPVOID pProxyResultEx)
    {
        if (WinhttpProxy::g_WinHttpFreeProxyResultEx)
            reinterpret_cast<void(WINAPI*)(LPVOID)>(WinhttpProxy::g_WinHttpFreeProxyResultEx)(pProxyResultEx);
    }

    __declspec(dllexport) void WINAPI Proxy_WinHttpFreeQueryConnectionGroupResult(LPVOID pResult)
    {
        if (WinhttpProxy::g_WinHttpFreeQueryConnectionGroupResult)
            reinterpret_cast<void(WINAPI*)(LPVOID)>(WinhttpProxy::g_WinHttpFreeQueryConnectionGroupResult)(pResult);
    }

    __declspec(dllexport) BOOL WINAPI Proxy_WinHttpGetDefaultProxyConfiguration(LPVOID pProxyInfo)
    {
        if (WinhttpProxy::g_WinHttpGetDefaultProxyConfiguration)
            return reinterpret_cast<BOOL(WINAPI*)(LPVOID)>(WinhttpProxy::g_WinHttpGetDefaultProxyConfiguration)(pProxyInfo);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_WinHttpGetIEProxyConfigForCurrentUser(LPVOID pProxyConfig)
    {
        if (WinhttpProxy::g_WinHttpGetIEProxyConfigForCurrentUser)
            return reinterpret_cast<BOOL(WINAPI*)(LPVOID)>(WinhttpProxy::g_WinHttpGetIEProxyConfigForCurrentUser)(pProxyConfig);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_WinHttpGetProxyForUrl(HINTERNET hSession, LPCWSTR lpcwszUrl, LPVOID pAutoProxyOptions, LPVOID pProxyInfo)
    {
        if (WinhttpProxy::g_WinHttpGetProxyForUrl)
            return reinterpret_cast<BOOL(WINAPI*)(HINTERNET, LPCWSTR, LPVOID, LPVOID)>(WinhttpProxy::g_WinHttpGetProxyForUrl)(hSession, lpcwszUrl, pAutoProxyOptions, pProxyInfo);
        return FALSE;
    }

    __declspec(dllexport) DWORD WINAPI Proxy_WinHttpGetProxyForUrlEx(HINTERNET hResolver, LPCWSTR pcwszUrl, LPVOID pAutoProxyOptions, DWORD_PTR pContext)
    {
        if (WinhttpProxy::g_WinHttpGetProxyForUrlEx)
            return reinterpret_cast<DWORD(WINAPI*)(HINTERNET, LPCWSTR, LPVOID, DWORD_PTR)>(WinhttpProxy::g_WinHttpGetProxyForUrlEx)(hResolver, pcwszUrl, pAutoProxyOptions, pContext);
        return ERROR_NOT_SUPPORTED;
    }

    __declspec(dllexport) DWORD WINAPI Proxy_WinHttpGetProxyForUrlEx2(HINTERNET hResolver, LPCWSTR pcwszUrl, LPVOID pAutoProxyOptions, DWORD cbCtx, LPVOID pCtx, DWORD_PTR pContext)
    {
        if (WinhttpProxy::g_WinHttpGetProxyForUrlEx2)
            return reinterpret_cast<DWORD(WINAPI*)(HINTERNET, LPCWSTR, LPVOID, DWORD, LPVOID, DWORD_PTR)>(WinhttpProxy::g_WinHttpGetProxyForUrlEx2)(hResolver, pcwszUrl, pAutoProxyOptions, cbCtx, pCtx, pContext);
        return ERROR_NOT_SUPPORTED;
    }

    __declspec(dllexport) DWORD WINAPI Proxy_WinHttpGetProxyResult(HINTERNET hResolver, LPVOID pProxyResult)
    {
        if (WinhttpProxy::g_WinHttpGetProxyResult)
            return reinterpret_cast<DWORD(WINAPI*)(HINTERNET, LPVOID)>(WinhttpProxy::g_WinHttpGetProxyResult)(hResolver, pProxyResult);
        return ERROR_NOT_SUPPORTED;
    }

    __declspec(dllexport) DWORD WINAPI Proxy_WinHttpGetProxyResultEx(HINTERNET hResolver, LPVOID pProxyResultEx)
    {
        if (WinhttpProxy::g_WinHttpGetProxyResultEx)
            return reinterpret_cast<DWORD(WINAPI*)(HINTERNET, LPVOID)>(WinhttpProxy::g_WinHttpGetProxyResultEx)(hResolver, pProxyResultEx);
        return ERROR_NOT_SUPPORTED;
    }

    __declspec(dllexport) DWORD WINAPI Proxy_WinHttpGetProxySettings(HINTERNET hSession, DWORD dwParam, LPVOID pReserved, LPVOID pSettings)
    {
        if (WinhttpProxy::g_WinHttpGetProxySettings)
            return reinterpret_cast<DWORD(WINAPI*)(HINTERNET, DWORD, LPVOID, LPVOID)>(WinhttpProxy::g_WinHttpGetProxySettings)(hSession, dwParam, pReserved, pSettings);
        return ERROR_NOT_SUPPORTED;
    }

    __declspec(dllexport) DWORD WINAPI Proxy_WinHttpGetProxySettingsResultEx(HINTERNET hResolver, LPVOID pProxySettingsEx)
    {
        if (WinhttpProxy::g_WinHttpGetProxySettingsResultEx)
            return reinterpret_cast<DWORD(WINAPI*)(HINTERNET, LPVOID)>(WinhttpProxy::g_WinHttpGetProxySettingsResultEx)(hResolver, pProxySettingsEx);
        return ERROR_NOT_SUPPORTED;
    }

    __declspec(dllexport) DWORD WINAPI Proxy_WinHttpGetProxySettingsVersion(HINTERNET hSession, LPDWORD pdwVersion)
    {
        if (WinhttpProxy::g_WinHttpGetProxySettingsVersion)
            return reinterpret_cast<DWORD(WINAPI*)(HINTERNET, LPDWORD)>(WinhttpProxy::g_WinHttpGetProxySettingsVersion)(hSession, pdwVersion);
        return ERROR_NOT_SUPPORTED;
    }

    __declspec(dllexport) DWORD WINAPI Proxy_WinHttpGetTunnelSocket(HINTERNET hInternet, DWORD dwFlags, LPVOID* ppvSocket)
    {
        if (WinhttpProxy::g_WinHttpGetTunnelSocket)
            return reinterpret_cast<DWORD(WINAPI*)(HINTERNET, DWORD, LPVOID*)>(WinhttpProxy::g_WinHttpGetTunnelSocket)(hInternet, dwFlags, ppvSocket);
        return ERROR_NOT_SUPPORTED;
    }

    __declspec(dllexport) HINTERNET WINAPI Proxy_WinHttpOpen(LPCWSTR pszAgentW, DWORD dwAccessType, LPCWSTR pszProxyW, LPCWSTR pszProxyBypassW, DWORD dwFlags)
    {
        if (WinhttpProxy::g_WinHttpOpen)
            return reinterpret_cast<HINTERNET(WINAPI*)(LPCWSTR, DWORD, LPCWSTR, LPCWSTR, DWORD)>(WinhttpProxy::g_WinHttpOpen)(pszAgentW, dwAccessType, pszProxyW, pszProxyBypassW, dwFlags);
        return nullptr;
    }

    __declspec(dllexport) HINTERNET WINAPI Proxy_WinHttpOpenRequest(HINTERNET hConnect, LPCWSTR pwszVerb, LPCWSTR pwszObjectName, LPCWSTR pwszVersion, LPCWSTR pwszReferrer, LPCWSTR* ppwszAcceptTypes, DWORD dwFlags)
    {
        if (WinhttpProxy::g_WinHttpOpenRequest)
            return reinterpret_cast<HINTERNET(WINAPI*)(HINTERNET, LPCWSTR, LPCWSTR, LPCWSTR, LPCWSTR, LPCWSTR*, DWORD)>(WinhttpProxy::g_WinHttpOpenRequest)(hConnect, pwszVerb, pwszObjectName, pwszVersion, pwszReferrer, ppwszAcceptTypes, dwFlags);
        return nullptr;
    }

    __declspec(dllexport) DWORD WINAPI Proxy_WinHttpProbeConnectivity(HINTERNET hInternet, DWORD dwFlags, LPVOID pSockAddr, DWORD cbSockAddr, LPDWORD pdwStatus)
    {
        if (WinhttpProxy::g_WinHttpProbeConnectivity)
            return reinterpret_cast<DWORD(WINAPI*)(HINTERNET, DWORD, LPVOID, DWORD, LPDWORD)>(WinhttpProxy::g_WinHttpProbeConnectivity)(hInternet, dwFlags, pSockAddr, cbSockAddr, pdwStatus);
        return ERROR_NOT_SUPPORTED;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_WinHttpQueryAuthSchemes(HINTERNET hRequest, LPDWORD lpdwSupported, LPDWORD lpdwFirst, LPDWORD pdwTarget)
    {
        if (WinhttpProxy::g_WinHttpQueryAuthSchemes)
            return reinterpret_cast<BOOL(WINAPI*)(HINTERNET, LPDWORD, LPDWORD, LPDWORD)>(WinhttpProxy::g_WinHttpQueryAuthSchemes)(hRequest, lpdwSupported, lpdwFirst, pdwTarget);
        return FALSE;
    }

    __declspec(dllexport) DWORD WINAPI Proxy_WinHttpQueryConnectionGroup(HINTERNET hInternet, LPVOID pGuid, ULONGLONG ullFlags, LPVOID* ppResult)
    {
        if (WinhttpProxy::g_WinHttpQueryConnectionGroup)
            return reinterpret_cast<DWORD(WINAPI*)(HINTERNET, LPVOID, ULONGLONG, LPVOID*)>(WinhttpProxy::g_WinHttpQueryConnectionGroup)(hInternet, pGuid, ullFlags, ppResult);
        return ERROR_NOT_SUPPORTED;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_WinHttpQueryDataAvailable(HINTERNET hRequest, LPDWORD lpdwBytes)
    {
        if (WinhttpProxy::g_WinHttpQueryDataAvailable)
            return reinterpret_cast<BOOL(WINAPI*)(HINTERNET, LPDWORD)>(WinhttpProxy::g_WinHttpQueryDataAvailable)(hRequest, lpdwBytes);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_WinHttpQueryHeaders(HINTERNET hRequest, DWORD dwInfoLevel, LPCWSTR pwszName, LPVOID lpBuffer, LPDWORD lpdwBufferLength, LPDWORD lpdwIndex)
    {
        if (WinhttpProxy::g_WinHttpQueryHeaders)
            return reinterpret_cast<BOOL(WINAPI*)(HINTERNET, DWORD, LPCWSTR, LPVOID, LPDWORD, LPDWORD)>(WinhttpProxy::g_WinHttpQueryHeaders)(hRequest, dwInfoLevel, pwszName, lpBuffer, lpdwBufferLength, lpdwIndex);
        return FALSE;
    }

    __declspec(dllexport) DWORD WINAPI Proxy_WinHttpQueryHeadersEx(HINTERNET hRequest, DWORD dwInfoLevel, ULONGLONG ullFlags, DWORD uiCodePage, LPDWORD pdwIndex, LPVOID pHeaderName, LPVOID pBuffer, LPDWORD pdwBufferLength)
    {
        if (WinhttpProxy::g_WinHttpQueryHeadersEx)
            return reinterpret_cast<DWORD(WINAPI*)(HINTERNET, DWORD, ULONGLONG, DWORD, LPDWORD, LPVOID, LPVOID, LPDWORD)>(WinhttpProxy::g_WinHttpQueryHeadersEx)(hRequest, dwInfoLevel, ullFlags, uiCodePage, pdwIndex, pHeaderName, pBuffer, pdwBufferLength);
        return ERROR_NOT_SUPPORTED;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_WinHttpQueryOption(HINTERNET hInternet, DWORD dwOption, LPVOID lpBuffer, LPDWORD lpdwBufferLength)
    {
        if (WinhttpProxy::g_WinHttpQueryOption)
            return reinterpret_cast<BOOL(WINAPI*)(HINTERNET, DWORD, LPVOID, LPDWORD)>(WinhttpProxy::g_WinHttpQueryOption)(hInternet, dwOption, lpBuffer, lpdwBufferLength);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_WinHttpReadData(HINTERNET hRequest, LPVOID lpBuffer, DWORD dwNumberOfBytesToRead, LPDWORD lpdwNumberOfBytesRead)
    {
        if (WinhttpProxy::g_WinHttpReadData)
            return reinterpret_cast<BOOL(WINAPI*)(HINTERNET, LPVOID, DWORD, LPDWORD)>(WinhttpProxy::g_WinHttpReadData)(hRequest, lpBuffer, dwNumberOfBytesToRead, lpdwNumberOfBytesRead);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_WinHttpReadDataEx(HINTERNET hRequest, LPVOID lpBuffer, DWORD dwNumberOfBytesToRead, LPDWORD lpdwNumberOfBytesRead, ULONGLONG ullFlags, DWORD cbProperty, PVOID pvProperty)
    {
        if (WinhttpProxy::g_WinHttpReadDataEx)
            return reinterpret_cast<BOOL(WINAPI*)(HINTERNET, LPVOID, DWORD, LPDWORD, ULONGLONG, DWORD, PVOID)>(WinhttpProxy::g_WinHttpReadDataEx)(hRequest, lpBuffer, dwNumberOfBytesToRead, lpdwNumberOfBytesRead, ullFlags, cbProperty, pvProperty);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_WinHttpReceiveResponse(HINTERNET hRequest, LPVOID lpReserved)
    {
        if (WinhttpProxy::g_WinHttpReceiveResponse)
            return reinterpret_cast<BOOL(WINAPI*)(HINTERNET, LPVOID)>(WinhttpProxy::g_WinHttpReceiveResponse)(hRequest, lpReserved);
        return FALSE;
    }

    __declspec(dllexport) DWORD WINAPI Proxy_WinHttpRegisterProxyChangeNotification(ULONGLONG ullFlags, LPVOID pfnCallback, LPVOID pvContext, LPVOID* hRegistration)
    {
        if (WinhttpProxy::g_WinHttpRegisterProxyChangeNotification)
            return reinterpret_cast<DWORD(WINAPI*)(ULONGLONG, LPVOID, LPVOID, LPVOID*)>(WinhttpProxy::g_WinHttpRegisterProxyChangeNotification)(ullFlags, pfnCallback, pvContext, hRegistration);
        return ERROR_NOT_SUPPORTED;
    }

    __declspec(dllexport) DWORD WINAPI Proxy_WinHttpResetAutoProxy(HINTERNET hSession, DWORD dwFlags)
    {
        if (WinhttpProxy::g_WinHttpResetAutoProxy)
            return reinterpret_cast<DWORD(WINAPI*)(HINTERNET, DWORD)>(WinhttpProxy::g_WinHttpResetAutoProxy)(hSession, dwFlags);
        return ERROR_NOT_SUPPORTED;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_WinHttpSendRequest(HINTERNET hRequest, LPCWSTR lpszHeaders, DWORD dwHeadersLength, LPVOID lpOptional, DWORD dwOptionalLength, DWORD dwTotalLength, DWORD_PTR dwContext)
    {
        if (WinhttpProxy::g_WinHttpSendRequest)
            return reinterpret_cast<BOOL(WINAPI*)(HINTERNET, LPCWSTR, DWORD, LPVOID, DWORD, DWORD, DWORD_PTR)>(WinhttpProxy::g_WinHttpSendRequest)(hRequest, lpszHeaders, dwHeadersLength, lpOptional, dwOptionalLength, dwTotalLength, dwContext);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_WinHttpSetCredentials(HINTERNET hRequest, DWORD AuthTargets, DWORD AuthScheme, LPCWSTR pwszUserName, LPCWSTR pwszPassword, LPVOID pAuthParams)
    {
        if (WinhttpProxy::g_WinHttpSetCredentials)
            return reinterpret_cast<BOOL(WINAPI*)(HINTERNET, DWORD, DWORD, LPCWSTR, LPCWSTR, LPVOID)>(WinhttpProxy::g_WinHttpSetCredentials)(hRequest, AuthTargets, AuthScheme, pwszUserName, pwszPassword, pAuthParams);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_WinHttpSetDefaultProxyConfiguration(LPVOID pProxyInfo)
    {
        if (WinhttpProxy::g_WinHttpSetDefaultProxyConfiguration)
            return reinterpret_cast<BOOL(WINAPI*)(LPVOID)>(WinhttpProxy::g_WinHttpSetDefaultProxyConfiguration)(pProxyInfo);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_WinHttpSetOption(HINTERNET hInternet, DWORD dwOption, LPVOID lpBuffer, DWORD dwBufferLength)
    {
        if (WinhttpProxy::g_WinHttpSetOption)
            return reinterpret_cast<BOOL(WINAPI*)(HINTERNET, DWORD, LPVOID, DWORD)>(WinhttpProxy::g_WinHttpSetOption)(hInternet, dwOption, lpBuffer, dwBufferLength);
        return FALSE;
    }

    __declspec(dllexport) DWORD WINAPI Proxy_WinHttpSetProxySettings(HINTERNET hSession, DWORD dwParam, LPVOID pReserved, LPVOID pSettings)
    {
        if (WinhttpProxy::g_WinHttpSetProxySettings)
            return reinterpret_cast<DWORD(WINAPI*)(HINTERNET, DWORD, LPVOID, LPVOID)>(WinhttpProxy::g_WinHttpSetProxySettings)(hSession, dwParam, pReserved, pSettings);
        return ERROR_NOT_SUPPORTED;
    }

    __declspec(dllexport) FARPROC WINAPI Proxy_WinHttpSetStatusCallback(HINTERNET hInternet, FARPROC lpfnCallback, DWORD dwNotificationFlags, DWORD_PTR dwReserved)
    {
        if (WinhttpProxy::g_WinHttpSetStatusCallback)
            return reinterpret_cast<FARPROC(WINAPI*)(HINTERNET, FARPROC, DWORD, DWORD_PTR)>(WinhttpProxy::g_WinHttpSetStatusCallback)(hInternet, lpfnCallback, dwNotificationFlags, dwReserved);
        return nullptr;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_WinHttpSetTimeouts(HINTERNET hInternet, int nResolveTimeout, int nConnectTimeout, int nSendTimeout, int nReceiveTimeout)
    {
        if (WinhttpProxy::g_WinHttpSetTimeouts)
            return reinterpret_cast<BOOL(WINAPI*)(HINTERNET, int, int, int, int)>(WinhttpProxy::g_WinHttpSetTimeouts)(hInternet, nResolveTimeout, nConnectTimeout, nSendTimeout, nReceiveTimeout);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_WinHttpTimeFromSystemTime(const SYSTEMTIME* pst, LPWSTR pwszTime)
    {
        if (WinhttpProxy::g_WinHttpTimeFromSystemTime)
            return reinterpret_cast<BOOL(WINAPI*)(const SYSTEMTIME*, LPWSTR)>(WinhttpProxy::g_WinHttpTimeFromSystemTime)(pst, pwszTime);
        return FALSE;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_WinHttpTimeToSystemTime(LPCWSTR pwszTime, SYSTEMTIME* pst)
    {
        if (WinhttpProxy::g_WinHttpTimeToSystemTime)
            return reinterpret_cast<BOOL(WINAPI*)(LPCWSTR, SYSTEMTIME*)>(WinhttpProxy::g_WinHttpTimeToSystemTime)(pwszTime, pst);
        return FALSE;
    }

    __declspec(dllexport) DWORD WINAPI Proxy_WinHttpUnregisterProxyChangeNotification(LPVOID hRegistration)
    {
        if (WinhttpProxy::g_WinHttpUnregisterProxyChangeNotification)
            return reinterpret_cast<DWORD(WINAPI*)(LPVOID)>(WinhttpProxy::g_WinHttpUnregisterProxyChangeNotification)(hRegistration);
        return ERROR_NOT_SUPPORTED;
    }

    __declspec(dllexport) DWORD WINAPI Proxy_WinHttpWebSocketClose(HINTERNET hWebSocket, USHORT usStatus, PVOID pvReason, DWORD dwReasonLength)
    {
        if (WinhttpProxy::g_WinHttpWebSocketClose)
            return reinterpret_cast<DWORD(WINAPI*)(HINTERNET, USHORT, PVOID, DWORD)>(WinhttpProxy::g_WinHttpWebSocketClose)(hWebSocket, usStatus, pvReason, dwReasonLength);
        return ERROR_NOT_SUPPORTED;
    }

    __declspec(dllexport) HINTERNET WINAPI Proxy_WinHttpWebSocketCompleteUpgrade(HINTERNET hRequest, DWORD_PTR pContext)
    {
        if (WinhttpProxy::g_WinHttpWebSocketCompleteUpgrade)
            return reinterpret_cast<HINTERNET(WINAPI*)(HINTERNET, DWORD_PTR)>(WinhttpProxy::g_WinHttpWebSocketCompleteUpgrade)(hRequest, pContext);
        return nullptr;
    }

    __declspec(dllexport) DWORD WINAPI Proxy_WinHttpWebSocketQueryCloseStatus(HINTERNET hWebSocket, LPWORD pusStatus, PVOID pvReason, DWORD dwReasonLength, LPDWORD pdwReasonLengthConsumed)
    {
        if (WinhttpProxy::g_WinHttpWebSocketQueryCloseStatus)
            return reinterpret_cast<DWORD(WINAPI*)(HINTERNET, LPWORD, PVOID, DWORD, LPDWORD)>(WinhttpProxy::g_WinHttpWebSocketQueryCloseStatus)(hWebSocket, pusStatus, pvReason, dwReasonLength, pdwReasonLengthConsumed);
        return ERROR_NOT_SUPPORTED;
    }

    __declspec(dllexport) DWORD WINAPI Proxy_WinHttpWebSocketReceive(HINTERNET hWebSocket, PVOID pvBuffer, DWORD dwBufferLength, LPDWORD pdwBytesRead, LPDWORD peBufferType)
    {
        if (WinhttpProxy::g_WinHttpWebSocketReceive)
            return reinterpret_cast<DWORD(WINAPI*)(HINTERNET, PVOID, DWORD, LPDWORD, LPDWORD)>(WinhttpProxy::g_WinHttpWebSocketReceive)(hWebSocket, pvBuffer, dwBufferLength, pdwBytesRead, peBufferType);
        return ERROR_NOT_SUPPORTED;
    }

    __declspec(dllexport) DWORD WINAPI Proxy_WinHttpWebSocketSend(HINTERNET hWebSocket, DWORD eBufferType, PVOID pvBuffer, DWORD dwBufferLength)
    {
        if (WinhttpProxy::g_WinHttpWebSocketSend)
            return reinterpret_cast<DWORD(WINAPI*)(HINTERNET, DWORD, PVOID, DWORD)>(WinhttpProxy::g_WinHttpWebSocketSend)(hWebSocket, eBufferType, pvBuffer, dwBufferLength);
        return ERROR_NOT_SUPPORTED;
    }

    __declspec(dllexport) DWORD WINAPI Proxy_WinHttpWebSocketShutdown(HINTERNET hWebSocket, USHORT usStatus, PVOID pvReason, DWORD dwReasonLength)
    {
        if (WinhttpProxy::g_WinHttpWebSocketShutdown)
            return reinterpret_cast<DWORD(WINAPI*)(HINTERNET, USHORT, PVOID, DWORD)>(WinhttpProxy::g_WinHttpWebSocketShutdown)(hWebSocket, usStatus, pvReason, dwReasonLength);
        return ERROR_NOT_SUPPORTED;
    }

    __declspec(dllexport) BOOL WINAPI Proxy_WinHttpWriteData(HINTERNET hRequest, LPCVOID lpBuffer, DWORD dwNumberOfBytesToWrite, LPDWORD lpdwNumberOfBytesWritten)
    {
        if (WinhttpProxy::g_WinHttpWriteData)
            return reinterpret_cast<BOOL(WINAPI*)(HINTERNET, LPCVOID, DWORD, LPDWORD)>(WinhttpProxy::g_WinHttpWriteData)(hRequest, lpBuffer, dwNumberOfBytesToWrite, lpdwNumberOfBytesWritten);
        return FALSE;
    }
}
