//! Given Rust/BorshSchema, generate TS types to encode/decode data.
mod builder;
pub mod errors;
mod generator;
use crate::builder::build_world;
use crate::generator::generate_ts;
use std::path::PathBuf;
mod parser;
pub mod ts;

fn main() {
    let out_dir = std::env::var("OUT_DIR").unwrap_or("outdir".to_string());
    std::fs::create_dir_all(&out_dir).unwrap();
    nord_gen(out_dir.as_str());
}

pub fn nord_gen(out_dir: &str) {
    use engine::{Action, ActionKind};
    let (roots, items) = build_world::<(ActionKind, Action)>();
    let out_dir = PathBuf::from(out_dir);
    generate_ts(&out_dir, "nord", roots, items);
}
