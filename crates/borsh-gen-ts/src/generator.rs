use crate::errors::*;
use crate::ts::{Target, IMPORTS};
use std::io::Write;
use std::path::Path;

/// shortcut with unwrap.
/// we are simple here, assume output does not fails
macro_rules! writeln {
    ($output:ident, $($arg:tt)*) => {
        std::writeln!($output, $($arg)*).unwrap();
    };
}

/// shortcut with unwrap
/// we are simple here, assume output does not fails
macro_rules! write {
    ($output:ident, $($arg:tt)*) => {
        std::write!($output, $($arg)*).unwrap();
    };
}

pub fn generate_ts(
    out_dir: &Path,
    world: &str,
    _ts_root: Vec<Target>,
    generates: ordermap::OrderMap<String, Target>,
) {
    eprintln!("generates:{:#?}", generates);
    // as i see it seems got topologically sorted, seems because of BorshSchemaContainer and algorithm
    // so we generate without explcit sorting, but in case
    let world = format!("{world}.ts");
    let world_path = out_dir.join(world);
    let _ = std::fs::remove_file(&world_path);
    let mut output = std::fs::File::create_new(world_path).unwrap();

    write!(output, "{}", IMPORTS);

    for (ts_name, body) in generates {
        match body {
            Target::Wellknowns(_) | Target::String => {
                // we do not need generate for these nothing, until we add our own TS types and import them and consider native (written manually)
            }
            Target::Class(generated) => {
                write!(output, "export class {} {{ ", ts_name);

                for field in generated.fields {
                    match field.target {
                        Target::Wellknowns(terminal_symbols) => {
                            let borsh_type =
                                if let Some(fixed_length) = terminal_symbols.fixed_array {
                                    format!(
                                        "fixedArray(\"{}\", {})",
                                        terminal_symbols.borsh_ts, fixed_length
                                    )
                                } else if terminal_symbols.option {
                                    format!("option(\"{}\")", terminal_symbols.borsh_ts)
                                } else {
                                    format!("\"{}\"", terminal_symbols.borsh_ts)
                                };

                            write!(output, "@field({{type: {} }})", borsh_type);
                            write!(output, "{}: {};", field.name, terminal_symbols.ts);
                        }
                        Target::String => {
                            let borsh_type = "'string'";
                            write!(output, "@field({{type: {} }})", borsh_type);
                            write!(output, "{}: {};", field.name, "string");
                        }
                        Target::Class(generated) => {
                            let borsh_type = generated.ts_symbol.clone();

                            write!(output, "@field({{type: {} }})", borsh_type);

                            write!(output, "{}: {};", field.name, generated.ts_symbol);
                        }

                        Target::Transparent(declaration, _target) => {
                            let borsh_type = declaration;
                            write!(output, "@field({{type: {} }})", borsh_type);
                            write!(output, "{}: {};", field.name, borsh_type);
                        }
                        Target::Enum(generated) => {
                            let borsh_type = generated.ts_symbol.clone();
                            write!(output, "@field({{type: {} }})", borsh_type);
                            write!(output, "{}: {};", field.name, generated.ts_symbol);
                        }
                    }
                }
                write!(output, "constructor(data: {}) {{", ts_name);
                write!(output, "Object.assign(this, data);");
                write!(output, "}} }}");
            }
            Target::Transparent(_declaration, target) => {
                write!(output, "export class {} {{ ", ts_name);

                match *target {
                    Target::String => {
                        let borsh_type = "'string'";
                        write!(output, "@field({{type: {} }})", borsh_type);
                        write!(output, "{}: {};", "_0", "string");
                    }
                    Target::Wellknowns(terminal_symbols) => {
                        let borsh_type = if let Some(fixed_length) = terminal_symbols.fixed_array {
                            format!(
                                "fixedArray(\"{}\", {})",
                                terminal_symbols.borsh_ts, fixed_length
                            )
                        } else {
                            terminal_symbols.borsh_ts
                        };

                        write!(output, "@field({{type: {} }})", borsh_type);

                        write!(output, "{}: {};", "_0", terminal_symbols.ts);
                    }
                    Target::Class(class) => {
                        let borsh_type = class.ts_symbol.clone();

                        write!(output, "@field({{type: \"{}\" }})", borsh_type);
                        write!(output, "{}: {};", "_0", class.ts_symbol);
                    }

                    Target::Transparent(_declaration, _target) => {
                        unimplemented!("{:?}", Error::E0001)
                    }
                    Target::Enum(enumeration) => {
                        let borsh_type = enumeration.ts_symbol.clone();

                        write!(output, "@field({{type: \"{}\" }})", borsh_type);

                        write!(output, "{}: {};", "_0", enumeration.ts_symbol);
                    }
                }

                write!(output, "constructor(data: {}) {{", ts_name);
                write!(output, "Object.assign(this, data);");
                write!(output, "}} }}");
            }
            Target::Enum(enumeration) => {
                write!(output, "@variant([");
                for variant in enumeration.variants.iter() {
                    write!(output, "{}", variant.discriminant);
                    write!(output, ",");
                }
                writeln!(output, "])");
                writeln!(output, "export class {} {{ }}", enumeration.ts_symbol,);

                for variant in enumeration.variants {
                    writeln!(output, "@variant({})", variant.discriminant);
                    writeln!(
                        output,
                        "export class {} extends {} {{",
                        variant.ts_symbol, enumeration.ts_symbol
                    );
                    if let Some(target) = variant.inner {
                        let cleanup = enumeration.ts_symbol.replace("Enum", "");
                        let cleanup = target.ts_name().replace(cleanup.as_str(), "");
                        writeln!(output, "@field({{type: \"{}\" }})", cleanup);
                        writeln!(output, "{}: {};", "_0", cleanup);
                    }
                    writeln!(output, "}}");
                }
            }
        }
    }
    crate::ts::fmt_check();
}
