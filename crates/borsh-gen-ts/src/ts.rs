//! Rust/BorshSchema -> TS type system reconcilation, mappings and utils.
//! See https://github.com/dao-xyz/borsh-ts?tab=readme-ov-file for details.
//! Contains validators that Rust symbols(idenity name) are also valid TS symbols as used.

use crate::errors::*;

pub const IMPORTS: &str = include_str!("./imports.ts");

#[derive(Debug, Clone)]
pub struct Field {
    pub target: Target,
    pub name: String,
    pub _option: bool,
}

#[derive(Debug, Clone)]
pub struct Class {
    pub ts_symbol: String,
    pub fields: Vec<Field>,
}

#[derive(Debug, Clone)]
pub enum Target {
    /// Just reuse base types
    Wellknowns(Wellknowns),
    // TS can view these as aliases
    Transparent(String, Box<Target>),
    Class(Class),
    // TS has not enums as of now, so modelled open set of classes
    Enum(Enum),
    // Always has special treatment, neither primitive nor array
    String,
}
impl Target {
    pub fn ts_name(&self) -> String {
        match self {
            Target::Wellknowns(wellknown) => {
                if wellknown.option {
                    format!("{} | undefined", wellknown.ts)
                } else {
                    wellknown.ts.clone()
                }
            }
            Target::Transparent(ts_name, _) => ts_name.clone(),
            Target::Class(class) => class.ts_symbol.clone(),
            Target::Enum(enumeration) => enumeration.ts_symbol.clone(),
            Target::String => "string".to_string(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Variant {
    pub ts_symbol: String,
    /// Inner type of data within enum variant.
    pub inner: Option<Target>,
    pub discriminant: u8,
}

#[derive(Debug, Clone)]
pub struct Enum {
    /// Name of super class with all discriminants
    pub ts_symbol: String,
    pub variants: Vec<Variant>,
}

/// Symbols for which we do not need generator and are import or builtins into TS.
#[derive(Debug, Clone)]
pub struct Wellknowns {
    pub borsh_ts: String,
    pub ts: String,
    pub fixed_array: Option<u16>,
    pub option: bool,
}

impl Wellknowns {
    pub fn number(declaration: String) -> Self {
        Self {
            borsh_ts: declaration.to_string(),
            ts: "number".to_string(),
            fixed_array: None,
            option: false,
        }
    }

    pub fn boolean(declaration: String) -> Self {
        Self {
            borsh_ts: declaration.to_string(),
            ts: "boolean".to_string(),
            fixed_array: None,
            option: false,
        }
    }

    pub fn bigint(declaration: String) -> Self {
        Self {
            borsh_ts: declaration.to_string(),
            ts: "bigint".to_string(),
            fixed_array: None,
            option: false,
        }
    }

    pub fn fixed_length_array(declaration: String, fixed_length: u16, ts: String) -> Self {
        if declaration == "u8" {
            Self {
                borsh_ts: declaration.to_string(),
                ts: "Uint8Array".to_string(),
                fixed_array: fixed_length.into(),
                option: false,
            }
        } else {
            Self {
                borsh_ts: declaration.to_string(),
                fixed_array: fixed_length.into(),
                ts: format!("{ts}[]"),
                option: false,
            }
        }
    }

    pub fn option(declaration: String, ts: String) -> Self {
        Self {
            borsh_ts: declaration.to_string(),
            ts: format!("{ts} | undefined"),
            fixed_array: None,
            option: true,
        }
    }
}

pub fn fmt_check() {
    if let Err(err) = std::process::Command::new("deno").arg("fmt").spawn() {
        match err.kind() {
            std::io::ErrorKind::NotFound => {
                eprintln!("{:?}", Warning::DenoNotFound);
            }
            _ => {
                panic!("Error running Deno: {:?}", err);
            }
        }
    }
}

// TS has no non zero primitives and that is hard to create
// So we can use aliases if needed
pub fn ts_non_zero(nonzero: &str) -> String {
    nonzero.replace("NonZero", "").to_lowercase()
}
