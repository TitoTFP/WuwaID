// KuroHotPatch_export_stubs.cpp
//
// The ConfigDB exporter reads files from the game's already-mounted virtual
// filesystem. Re-mounting all game PAKs from the export worker thread triggers
// Puerts callbacks outside the allowed JavaScript execution scope and can
// terminate the game. Keep the generated SDK declarations linkable while
// making the exporter-specific PAK mounting calls intentional no-ops.

#include "SDK.hpp"

namespace SDK
{

void UKuroPakMountStatic::MountGamePaks()
{
    // The game has already mounted its PAKs before the exporter is injected.
}

void UKuroPakMountStatic::MountMultiLangPaks()
{
    // Locale databases are read from the existing virtual filesystem mounts.
}

void UKuroPakMountStatic::MountPak(const class FString& Path, int32 Order)
{
    (void)Path;
    (void)Order;
}

void UKuroPakMountStatic::RemoveSha1Check(const class FString& FilePath)
{
    (void)FilePath;
}

} // namespace SDK
