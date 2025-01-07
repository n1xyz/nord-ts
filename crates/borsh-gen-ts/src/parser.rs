//! Instead of stringly "typed" matches(as in borsh_diff ), or regexes, we use (partial) Rust parser.
//! `syn` parses whatever Rust proc macro can parse.
//! In case we decide to do our own macro, will have some code to use.
//! Here some big setup code, but as syn will be used more, it will pay off.
//!
//! Alternative approach to what is going here is
//! to run full Rust parser on separated crate for DSL (Rust as external DSL) or using WIT(I prefer this)
//! I do not think that investing own DSL is good idea now (I saw how much time it takes, so we are not here yet).

use syn::{parse_str, GenericArgument, PathArguments, Type};

/// Parses a Rust type string to check if it's an `Option<T>` and extracts the generic type.
pub fn parse_option_type(type_str: &str) -> Result<Option<String>, String> {
    // Parse the type string into a `syn::Type`
    let parsed_type: Type = parse_str(type_str).map_err(|e| e.to_string())?;

    // Check if the type is `Option<T>` and extract `T`
    if let Type::Path(type_path) = parsed_type {
        if let Some(segment) = type_path.path.segments.last() {
            if segment.ident == "Option" {
                // Extract the generic argument `T` from `Option<T>`
                if let PathArguments::AngleBracketed(args) = &segment.arguments {
                    if let Some(GenericArgument::Type(inner_type)) = args.args.first() {
                        // Convert the inner type to a string
                        return Ok(Some(type_to_string(inner_type)));
                    }
                }
            }
        }
    }

    Ok(None) // Not an `Option<T>`
}

/// Helper function to convert a `syn::Type` to a string representation
fn type_to_string(ty: &Type) -> String {
    match ty {
        Type::Path(type_path) => type_path
            .path
            .segments
            .iter()
            .map(|segment| segment.ident.to_string())
            .collect::<Vec<_>>()
            .join("::"),
        _ => "Unsupported".to_string(),
    }
}
