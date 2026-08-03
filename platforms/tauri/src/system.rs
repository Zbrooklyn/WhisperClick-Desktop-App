//! System integration — key simulation, tray, hotkey.

#[cfg(target_os = "windows")]
pub fn simulate_paste() -> Result<(), String> {
    use std::mem::size_of;
    // These names are the Win32 ABI's, not ours. clippy::upper_case_acronyms
    // wants KEYBDINPUT/INPUT renamed to Keybdinput/Input, which would make the
    // declarations stop matching the winuser.h structs they mirror — the whole
    // point of a #[repr(C)] shim is that a reader can diff it against the
    // Microsoft docs by eye. Silenced deliberately, alongside non_snake_case,
    // which is muted here for exactly the same reason.
    #[allow(non_snake_case)]
    #[allow(clippy::upper_case_acronyms)]
    mod win {
        pub const VK_CONTROL: u16 = 0x11;
        pub const VK_V: u16 = 0x56;
        pub const KEYEVENTF_KEYUP: u32 = 0x0002;
        pub const INPUT_KEYBOARD: u32 = 1;

        #[repr(C)]
        pub struct KEYBDINPUT {
            pub wVk: u16,
            pub wScan: u16,
            pub dwFlags: u32,
            pub time: u32,
            pub dwExtraInfo: usize,
        }

        #[repr(C)]
        pub struct INPUT {
            pub r#type: u32,
            pub ki: KEYBDINPUT,
            pub padding: [u8; 8],
        }

        extern "system" {
            pub fn SendInput(cInputs: u32, pInputs: *const INPUT, cbSize: i32) -> u32;
        }
    }

    unsafe {
        let inputs = [
            win::INPUT {
                r#type: win::INPUT_KEYBOARD,
                ki: win::KEYBDINPUT {
                    wVk: win::VK_CONTROL,
                    wScan: 0,
                    dwFlags: 0,
                    time: 0,
                    dwExtraInfo: 0,
                },
                padding: [0; 8],
            },
            win::INPUT {
                r#type: win::INPUT_KEYBOARD,
                ki: win::KEYBDINPUT {
                    wVk: win::VK_V,
                    wScan: 0,
                    dwFlags: 0,
                    time: 0,
                    dwExtraInfo: 0,
                },
                padding: [0; 8],
            },
            win::INPUT {
                r#type: win::INPUT_KEYBOARD,
                ki: win::KEYBDINPUT {
                    wVk: win::VK_V,
                    wScan: 0,
                    dwFlags: win::KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
                padding: [0; 8],
            },
            win::INPUT {
                r#type: win::INPUT_KEYBOARD,
                ki: win::KEYBDINPUT {
                    wVk: win::VK_CONTROL,
                    wScan: 0,
                    dwFlags: win::KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
                padding: [0; 8],
            },
        ];
        win::SendInput(4, inputs.as_ptr(), size_of::<win::INPUT>() as i32);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn simulate_enter_key() -> Result<(), String> {
    use std::mem::size_of;
    // Same Win32 ABI names as in simulate_paste above — see the note there.
    #[allow(non_snake_case)]
    #[allow(clippy::upper_case_acronyms)]
    mod win {
        pub const VK_RETURN: u16 = 0x0D;
        pub const KEYEVENTF_KEYUP: u32 = 0x0002;
        pub const INPUT_KEYBOARD: u32 = 1;

        #[repr(C)]
        pub struct KEYBDINPUT {
            pub wVk: u16,
            pub wScan: u16,
            pub dwFlags: u32,
            pub time: u32,
            pub dwExtraInfo: usize,
        }

        #[repr(C)]
        pub struct INPUT {
            pub r#type: u32,
            pub ki: KEYBDINPUT,
            pub padding: [u8; 8],
        }

        extern "system" {
            pub fn SendInput(cInputs: u32, pInputs: *const INPUT, cbSize: i32) -> u32;
        }
    }

    unsafe {
        let inputs = [
            win::INPUT {
                r#type: win::INPUT_KEYBOARD,
                ki: win::KEYBDINPUT {
                    wVk: win::VK_RETURN,
                    wScan: 0,
                    dwFlags: 0,
                    time: 0,
                    dwExtraInfo: 0,
                },
                padding: [0; 8],
            },
            win::INPUT {
                r#type: win::INPUT_KEYBOARD,
                ki: win::KEYBDINPUT {
                    wVk: win::VK_RETURN,
                    wScan: 0,
                    dwFlags: win::KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
                padding: [0; 8],
            },
        ];
        win::SendInput(2, inputs.as_ptr(), size_of::<win::INPUT>() as i32);
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn simulate_paste() -> Result<(), String> {
    Err("Paste simulation not implemented for this platform".to_string())
}

#[cfg(not(target_os = "windows"))]
pub fn simulate_enter_key() -> Result<(), String> {
    Err("Enter simulation not implemented for this platform".to_string())
}
