/// Opinionated limits onto Rust to ensure types and maybe Rust code are clear to
/// TS(and whatever JS/Python/Solidity) developers.
/// For the rest, if not clear what is good, good is what WIT does.
#[derive(displaydoc::Display, Debug)]
pub enum Error {
    /// layers of unnamed stucts fields like  `Foo(Bar(Baz))` are not allowed. make less wrapping or write custom borsh schema
    E0001,
    /// tuples not to be in public API. replaces with named structs or fixed size arrays. 2-tuple is supported only in seqeunces (in this case first item may be considered key)
    E0002,
    /// f32 and f64 are not supported as non deterministic types
    E0003,

    // https://github.com/WebAssembly/component-model/issues/430
    /// recursive types are not supported. use custom borsh serialzied and schema or indexes approach to express recursion
    E0004,
    /// no unit or empty types
    E0005,
    /// wrappers like Box/Arc/Mutex/.. types are not supported. simplify, or use custom borsh serialize and schema
    E0006,
    /// all Rust identity name must also be valid TS symbols, in specific cases(generics), canonicalization algorithm used
    E0007,
    /// Only one type parameter is allowed per type, exclusion is key value like usage
    E0008,
    // https://github.com/WebAssembly/component-model/issues/125
    /// proper universal map and set support is hard, so not supported (replace with sequence and sequence of 2 tuples)
    E0009,
    /// enum variant can have 0 or one non empty(unit) field. similar to tuples error
    E0010,
}

#[derive(displaydoc::Display, Debug)]
pub enum Warning {
    /// we use external formatter and checker for generated code TS code. now it is `deno`, please add to path"
    DenoNotFound = 1,
}
