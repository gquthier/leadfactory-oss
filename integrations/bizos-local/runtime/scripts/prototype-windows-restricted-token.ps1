# QA-only Windows native shield prototype. Uses fake files, never product credentials.
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Windows required' }
$root = Join-Path $env:RUNNER_TEMP 'bizos-restricted-token-prototype'
New-Item -ItemType Directory -Force -Path $root | Out-Null
$secret = Join-Path $root 'fake-bizos-secret.txt'
$workspace = Join-Path $root 'fake-workspace.txt'
[IO.File]::WriteAllText($secret, 'fake-secret')
[IO.File]::WriteAllText($workspace, 'fake-workspace')
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
foreach ($file in @($secret, $workspace)) {
  & icacls $file /inheritance:r | Out-Null
  & icacls $file /remove:g '*S-1-5-11' '*S-1-5-32-545' '*S-1-1-0' | Out-Null
  & icacls $file /grant:r "${identity}:(R)" | Out-Null
}
& icacls $workspace /grant '*S-1-5-32-545:(R)' | Out-Null
if ([IO.File]::ReadAllText($secret) -ne 'fake-secret') { throw 'Test setup failed' }

Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

public static class BizosRestrictedTokenPrototype {
  [StructLayout(LayoutKind.Sequential)]
  public struct SidAndAttributes { public IntPtr Sid; public uint Attributes; }
  [DllImport("advapi32.dll", SetLastError=true)]
  static extern bool CreateRestrictedToken(IntPtr existing, uint flags, uint disableCount,
    IntPtr disableSids, uint deletePrivilegeCount, IntPtr deletePrivileges,
    uint restrictCount, [In] SidAndAttributes[] restrictSids, out IntPtr restricted);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool ConvertStringSidToSid(string text, out IntPtr sid);
  [DllImport("kernel32.dll")]
  static extern IntPtr LocalFree(IntPtr memory);

  public static void AssertFileIsolation(string secret, string workspace) {
    IntPtr sid;
    if (!ConvertStringSidToSid("S-1-5-32-545", out sid))
      throw new Win32Exception(Marshal.GetLastWin32Error());
    try {
      IntPtr raw;
      var original = WindowsIdentity.GetCurrent().AccessToken;
      var restrictions = new[] { new SidAndAttributes { Sid = sid, Attributes = 0 } };
      if (!CreateRestrictedToken(original.DangerousGetHandle(), 1, 0, IntPtr.Zero,
          0, IntPtr.Zero, 1, restrictions, out raw))
        throw new Win32Exception(Marshal.GetLastWin32Error());
      using (var token = new SafeAccessTokenHandle(raw)) {
        WindowsIdentity.RunImpersonated(token, () => {
          if (File.ReadAllText(workspace) != "fake-workspace")
            throw new Exception("Restricted token could not read the allowed workspace");
          try {
            File.ReadAllText(secret);
            throw new Exception("Restricted token read the fake BizOS secret");
          } catch (UnauthorizedAccessException) {
            // The second access check from the restricting SID denied the secret.
          }
        });
      }
    } finally { LocalFree(sid); }
  }
}
'@

try {
  [BizosRestrictedTokenPrototype]::AssertFileIsolation($secret, $workspace)
  Write-Host 'PASS: CreateRestrictedToken restricts fake BizOS secret while preserving workspace read'
} finally {
  Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
}
