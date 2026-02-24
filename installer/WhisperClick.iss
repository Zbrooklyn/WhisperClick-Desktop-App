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

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"; Flags: unchecked
Name: "startmenu"; Description: "Create a &Start Menu shortcut"; GroupDescription: "Additional icons:"
Name: "taskbarpin"; Description: "&Pin to taskbar"; GroupDescription: "Additional icons:"; Flags: unchecked
Name: "autostart"; Description: "Start with &Windows"; GroupDescription: "System integration:"

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
