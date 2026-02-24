; WhisperClick Windows installer script (Inno Setup 6)

#define MyAppName "WhisperClick"
#define MyAppPublisher "WhisperClick"
#define MyAppExeName "WhisperClick.exe"

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

#ifndef SourceDir
  #define SourceDir "..\dist\WhisperClick"
#endif

#ifndef OutputDir
  #define OutputDir "..\release"
#endif

[Setup]
AppId={{CC23DC22-3A4B-4DB8-88A8-5EBB5D8F5B5C}
AppName={#MyAppName}
AppVersion={#AppVersion}
AppVerName={#MyAppName} {#AppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\WhisperClick
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=commandline
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=WhisperClick-Setup-{#AppVersion}-windows-x64
SetupIconFile=..\assets\microphone_logo.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; Upgrade behavior
CloseApplications=yes
CloseApplicationsFilter={#MyAppExeName}
RestartApplications=yes
MinVersion=10.0

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"; Flags: unchecked
Name: "startmenu"; Description: "Create a &Start Menu shortcut"; GroupDescription: "Additional icons:"
Name: "taskbarpin"; Description: "&Pin to taskbar"; GroupDescription: "Additional icons:"; Flags: unchecked
Name: "autostart"; Description: "Start with &Windows"; GroupDescription: "System integration:"

[InstallDelete]
; Clean stale files from previous versions before installing new files
Type: filesandordirs; Name: "{app}\*"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: startmenu
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{userappdata}\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: taskbarpin

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "{#MyAppName}"; ValueData: """{app}\{#MyAppExeName}"""; Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent

[Code]
procedure KillRunningInstance();
var
  ResultCode: Integer;
begin
  { WhisperClick minimizes to system tray on close, so the Restart Manager
    cannot shut it down gracefully. Force-kill the process before installing. }
  Exec('taskkill.exe', '/F /IM {#MyAppExeName}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  { Brief pause to let the OS release file locks }
  Sleep(500);
end;

function InitializeSetup(): Boolean;
var
  InstalledVersion: String;
begin
  Result := True;
  { Warn if downgrading }
  if RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{{CC23DC22-3A4B-4DB8-88A8-5EBB5D8F5B5C}_is1', 'DisplayVersion', InstalledVersion) then
  begin
    if CompareStr(InstalledVersion, '{#AppVersion}') > 0 then
    begin
      Result := (MsgBox('Version ' + InstalledVersion + ' is already installed.' + #13#10 +
        'You are about to install an older version ({#AppVersion}).' + #13#10#13#10 +
        'Continue anyway?', mbConfirmation, MB_YESNO) = IDYES);
    end;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  NeedsRestart := False;
  KillRunningInstance();
end;
