//! Convert BorshShcema into TS generator friendly tree.
//!
//! Targets WIT like world approach.
//! Host vs guest,
//! client vs server,
//! debug vs release,
//! public vs private,
//! trusted vs untrusted,
//! can provide different world views and types generated.

use crate::errors::*;
use crate::parser::parse_option_type;
use crate::ts::{ts_non_zero, Class, Enum, Field, Target, Variant, Wellknowns};
use borsh::schema::{BorshSchemaContainer, Definition, Fields};
use borsh::BorshSchema;

pub fn build_world<World: BorshSchema>() -> (Vec<Target>, ordermap::OrderMap<String, Target>) {
    let schema = BorshSchemaContainer::for_type::<World>();
    schema.validate().unwrap();

    let mut generates = ordermap::OrderMap::new();

    let declaration = schema.declaration();
    let world = schema.get_definition(declaration).expect("must be world");
    let borsh::schema::Definition::Tuple { elements } = world else {
        panic!("world must be tuple");
    };

    let mut targets = Vec::new();
    for declaration in elements {
        let target = build_roots(
            &schema,
            declaration.as_str(),
            &mut generates,
            Parent::Irrelevant,
        );
        targets.push(target);
    }
    (targets, generates)
}

/// Rust <-> TS, nor Rust<-> BorshSchema do not have one to one correspondence.
/// and TS has several ways to express the same thing.
/// So wee need some parent context to help identify Rust/TS pattern to use for building generation tree.
/// Specifically Rust to TS enums https://github.com/dao-xyz/borsh-ts/issues/28
/// and Rust single unnamed field (transparent) wrappers.
#[derive(Debug, Clone, Copy)]
enum Parent {
    Enum,
    Struct,
    Irrelevant,
}

fn build_roots(
    schema: &BorshSchemaContainer,
    declaration: &str,
    generates: &mut ordermap::OrderMap<String, Target>,
    parent: Parent,
) -> Target {
    let maybe_option = parse_option_type(declaration);
    match generates.get(declaration) {
        Some(target) => target.clone(),
        None => match declaration {
            // map according
            "i64" | "u64" | "u128" | "i128" | "NonZeroU64" | "NonZeroI64" | "NonZeroU128"
            | "NonZeroI128" => {
                let target = Target::Wellknowns(Wellknowns::bigint(ts_non_zero(declaration)));
                insert(generates, declaration, target)
            }
            "u8" | "u16" | "u32" | "i8" | "i16" | "i32" | "NonZeroU8" | "NonZeroU16"
            | "NonZeroU32" | "NonZeroI8" | "NonZeroI16" | "NonZeroI32" => {
                let target = Target::Wellknowns(Wellknowns::number(ts_non_zero(declaration)));
                insert(generates, declaration, target)
            }
            "bool" => {
                let target = Target::Wellknowns(Wellknowns::number(declaration.to_string()));
                insert(generates, declaration, target)
            }
            declaration if maybe_option.clone().ok().flatten().is_some() => {
                let type_parameter = maybe_option.unwrap().unwrap();
                let target = build_roots(
                    schema,
                    type_parameter.as_str(),
                    generates,
                    Parent::Irrelevant,
                );

                let target = Target::Wellknowns(Wellknowns::option(
                    type_parameter.to_string(),
                    target.ts_name(),
                ));
                insert(generates, declaration, target)
            }
            declaration => {
                let defintion: &borsh::schema::Definition =
                    schema.get_definition(declaration).unwrap();
                match defintion {
                    borsh::schema::Definition::Primitive(_) => todo!("{}", declaration),
                    borsh::schema::Definition::Sequence {
                        length_width,
                        length_range,
                        elements,
                    } => {
                        let length_width = *length_width;
                        if length_width == 0 {
                            let fixed_length = *length_range.start() as u16;
                            let field_target =
                                build_roots(schema, elements, generates, Parent::Irrelevant);
                            let ts = match field_target {
                                Target::Wellknowns(terminal_symbols) => terminal_symbols.ts,
                                Target::Class(generated) => generated.ts_symbol,
                                Target::Transparent(_declaration, target) => match *target {
                                    Target::Wellknowns(terminal_symbols) => terminal_symbols.ts,
                                    Target::Class(generated) => generated.ts_symbol,
                                    _ => unimplemented!("{}", Error::E0001),
                                },
                                Target::String => todo!(),
                                Target::Enum(_) => todo!(),
                            };
                            let target = Wellknowns::fixed_length_array(
                                elements.to_string(),
                                fixed_length,
                                ts,
                            );
                            Target::Wellknowns(target)
                        } else {
                            Target::String
                        }
                    }
                    borsh::schema::Definition::Tuple { elements: _ } => {
                        unimplemented!("{}", Error::E0002)
                    }
                    borsh::schema::Definition::Enum {
                        tag_width,
                        variants,
                    } => match tag_width {
                        1 => {
                            let mut ts_variants = Vec::new();
                            for (discriminant, name, variant_value_declaration) in variants {
                                let discriminant = *discriminant as u8;

                                let target = if let Definition::Struct {
                                    fields: Fields::Empty,
                                } =
                                    schema.get_definition(variant_value_declaration).unwrap()
                                {
                                    None
                                } else {
                                    let target = build_roots(
                                        schema,
                                        variant_value_declaration,
                                        generates,
                                        Parent::Enum,
                                    );
                                    // bad design
                                    generates.remove(variant_value_declaration);
                                    Some(target)
                                };

                                let variant = Variant {
                                    ts_symbol: format!("{}Variant", name),
                                    inner: target,
                                    discriminant,
                                };
                                ts_variants.push(variant);
                            }
                            let target = Target::Enum(Enum {
                                ts_symbol: format!("{}Enum", declaration),
                                variants: ts_variants,
                            });
                            insert(generates, declaration, target)
                        }
                        _ => todo!("https://github.com/near/borsh/issues/151"),
                    },
                    borsh::schema::Definition::Struct { fields } => match fields {
                        borsh::schema::Fields::NamedFields(fields) => {
                            let mut ts_fields: Vec<Field> = Vec::new();
                            for (name, declaration) in fields {
                                let target =
                                    build_roots(schema, declaration, generates, Parent::Struct);
                                ts_fields.push(Field {
                                    target,
                                    name: name.to_string(),
                                    _option: false,
                                });
                            }

                            let target = Class {
                                ts_symbol: declaration.to_string(),
                                fields: ts_fields,
                            };
                            let target = Target::Class(target);
                            insert(generates, declaration, target)
                        }
                        borsh::schema::Fields::UnnamedFields(vec) => {
                            let target = match vec.as_slice() {
                                [declaration] => {
                                    build_roots(schema, declaration, generates, parent)
                                }
                                _ => unimplemented!("{}", Error::E0010),
                            };

                            let target = Target::Transparent(
                                match parent {
                                    Parent::Enum => target.ts_name(),
                                    _ => declaration.to_string(),
                                },
                                target.into(),
                            );
                            insert(generates, declaration, target)
                        }
                        borsh::schema::Fields::Empty => {
                            unimplemented!("{} {declaration}", Error::E0005)
                        }
                    },
                }
            }
        },
    }
}

/// I doubt we need hight perfromace in this crate, so I went with simple clones.
/// Also as per BorshSchema """spec"""", there are not duplicates, so we just assert that we do not do them either
fn insert(
    generates: &mut ordermap::OrderMap<String, Target>,
    declaration: &str,
    target: Target,
) -> Target {
    assert!(generates
        .insert(declaration.to_string(), target.clone())
        .is_none());
    target
}
