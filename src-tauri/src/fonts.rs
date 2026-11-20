use std::collections::BTreeMap;

#[tauri::command]
pub async fn list_terminal_fonts() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut families = BTreeMap::new();
        for name in platform_fonts()? {
            let name = name.trim();
            if !name.is_empty() {
                families
                    .entry(name.to_lowercase())
                    .or_insert_with(|| name.to_owned());
            }
        }
        Ok(families.into_values().collect())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(target_os = "windows")]
fn platform_fonts() -> Result<Vec<String>, String> {
    use windows::core::{w, Interface, BOOL};
    use windows::Win32::Graphics::DirectWrite::*;

    // DirectWrite owns the collection and its interfaces. The only output
    // buffer we provide is sized using the localized name's reported length.
    unsafe {
        let factory: IDWriteFactory =
            DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED).map_err(|error| error.to_string())?;
        let mut collection = None;
        factory
            .GetSystemFontCollection(&mut collection, true)
            .map_err(|error| error.to_string())?;
        let collection = collection.ok_or("DirectWrite returned no system font collection")?;

        let mut families = Vec::new();
        for index in 0..collection.GetFontFamilyCount() {
            let Ok(family) = collection.GetFontFamily(index) else {
                continue;
            };
            let Ok(font) = family.GetFirstMatchingFont(
                DWRITE_FONT_WEIGHT_NORMAL,
                DWRITE_FONT_STRETCH_NORMAL,
                DWRITE_FONT_STYLE_NORMAL,
            ) else {
                continue;
            };
            let Ok(font) = font.cast::<IDWriteFont1>() else {
                continue;
            };
            if !font.IsMonospacedFont().as_bool() {
                continue;
            }

            let Ok(names) = family.GetFamilyNames() else {
                continue;
            };
            let mut index = 0;
            let mut found = BOOL::default();
            let _ = names.FindLocaleName(w!("en-us"), &mut index, &mut found);
            let index = if found.as_bool() { index } else { 0 };
            let Ok(length) = names.GetStringLength(index) else {
                continue;
            };
            let mut utf16 = vec![0; length as usize + 1];
            if names.GetString(index, &mut utf16).is_ok() {
                families.push(String::from_utf16_lossy(&utf16[..length as usize]));
            }
        }
        Ok(families)
    }
}

#[cfg(target_os = "linux")]
fn platform_fonts() -> Result<Vec<String>, String> {
    let output = std::process::Command::new("fc-list")
        .args(["--format", "%{spacing}\t%{family[0]}\n"])
        .output()
        .map_err(|error| format!("Could not run fc-list: {error}"))?;
    if !output.status.success() {
        return Err(format!("fc-list failed: {}", output.status));
    }
    Ok(parse_fontconfig_families(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

#[cfg(any(target_os = "linux", test))]
fn parse_fontconfig_families(output: &str) -> Vec<String> {
    output
        .lines()
        .filter_map(|line| line.split_once('\t'))
        // Include dual-width families whose CJK glyphs occupy two terminal cells.
        .filter(|(spacing, _)| matches!(*spacing, "90" | "100" | "110"))
        .map(|(_, family)| family.to_owned())
        .collect()
}

#[cfg(target_os = "macos")]
fn platform_fonts() -> Result<Vec<String>, String> {
    use core_text::{font, font_collection, font_descriptor::SymbolicTraitAccessors};

    let collection = font_collection::create_for_all_families();
    let descriptors = collection
        .get_descriptors()
        .ok_or("Core Text returned no font descriptors")?;
    Ok(descriptors
        .iter()
        .map(|descriptor| font::new_from_descriptor(&descriptor, 0.0))
        .filter(|font| font.symbolic_traits().is_monospace())
        .map(|font| font.family_name())
        .filter(|family| !family.starts_with('.'))
        .collect())
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn platform_fonts() -> Result<Vec<String>, String> {
    Err("System font discovery is unavailable on this platform".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fontconfig_keeps_fixed_and_dual_width_families() {
        let rows = "0\tArial\n100\tDejaVu Sans Mono\n90\tSarasa Mono TC\n110\tFixed\n\tUnknown\n";
        assert_eq!(
            parse_fontconfig_families(rows),
            ["DejaVu Sans Mono", "Sarasa Mono TC", "Fixed"]
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn directwrite_reads_installed_fixed_width_families() {
        let names = platform_fonts().unwrap();
        assert!(
            names
                .iter()
                .any(|name| name == "Consolas" || name == "Courier New"),
            "{names:?}"
        );
        assert!(!names.iter().any(|name| name == "Arial"), "{names:?}");
    }
}
