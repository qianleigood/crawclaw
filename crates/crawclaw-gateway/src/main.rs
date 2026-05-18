#![recursion_limit = "256"]

use std::env;
use std::path::PathBuf;

use crawclaw_gateway::{call_local_gateway_method, run_gateway, GatewayBind, GatewayRunConfig};

#[tokio::main]
async fn main() {
    let mut bind = GatewayBind::Loopback;
    let mut port = 18789;
    let mut runtime_root: Option<PathBuf> = None;
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.first().map(String::as_str) == Some("call") {
        if let Err(error) = call_gateway_method(args.into_iter().skip(1).collect()).await {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    if args.first().map(String::as_str) == Some("emit-protocol-schema") {
        if let Err(error) = emit_protocol_schema(args.into_iter().skip(1).collect()) {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    if args.first().map(String::as_str) == Some("emit-protocol-artifacts") {
        if let Err(error) = emit_protocol_artifacts(args.into_iter().skip(1).collect()) {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    let mut index = 0;

    while index < args.len() {
        match args[index].as_str() {
            "--help" | "-h" => {
                print_help();
                return;
            }
            "--version" | "-V" => {
                println!("crawclaw-gateway {}", env!("CARGO_PKG_VERSION"));
                return;
            }
            "--bind" => {
                let Some(value) = args.get(index + 1) else {
                    exit_usage("--bind requires a value");
                };
                bind = parse_bind(value);
                index += 2;
            }
            "--port" => {
                let Some(value) = args.get(index + 1) else {
                    exit_usage("--port requires a value");
                };
                port = value
                    .parse::<u16>()
                    .unwrap_or_else(|_| exit_usage("--port must be a valid u16"));
                index += 2;
            }
            "--runtime-root" => {
                let Some(value) = args.get(index + 1) else {
                    exit_usage("--runtime-root requires a value");
                };
                runtime_root = Some(PathBuf::from(value));
                index += 2;
            }
            other => exit_usage(&format!("unsupported option: {other}")),
        }
    }

    let config = GatewayRunConfig {
        bind,
        port,
        runtime_root,
        ..GatewayRunConfig::default()
    };
    if let Err(error) = run_gateway(config).await {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn emit_protocol_schema(args: Vec<String>) -> Result<(), String> {
    if args.len() != 2 || args[0] != "--output" {
        return Err("usage: crawclaw-gateway emit-protocol-schema --output <path>".to_string());
    }
    write_protocol_artifact(
        &PathBuf::from(&args[1]),
        crawclaw_gateway::gateway_protocol_schema_json(),
        "schema",
    )
}

fn emit_protocol_artifacts(args: Vec<String>) -> Result<(), String> {
    let mut schema_output: Option<PathBuf> = None;
    let mut metadata_output: Option<PathBuf> = None;
    let mut schema_ts_output: Option<PathBuf> = None;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--schema-output" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("--schema-output requires a value".to_string());
                };
                schema_output = Some(PathBuf::from(value));
                index += 2;
            }
            "--metadata-output" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("--metadata-output requires a value".to_string());
                };
                metadata_output = Some(PathBuf::from(value));
                index += 2;
            }
            "--schema-ts-output" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("--schema-ts-output requires a value".to_string());
                };
                schema_ts_output = Some(PathBuf::from(value));
                index += 2;
            }
            other => {
                return Err(format!(
                    "unsupported emit-protocol-artifacts option: {other}"
                ))
            }
        }
    }
    let schema_output = schema_output.ok_or_else(|| {
        "usage: crawclaw-gateway emit-protocol-artifacts --schema-output <path> --metadata-output <path>"
            .to_string()
    })?;
    let metadata_output = metadata_output.ok_or_else(|| {
        "usage: crawclaw-gateway emit-protocol-artifacts --schema-output <path> --metadata-output <path> [--schema-ts-output <path>]"
            .to_string()
    })?;
    write_protocol_artifact(
        &schema_output,
        crawclaw_gateway::gateway_protocol_schema_json(),
        "schema",
    )?;
    write_protocol_artifact(
        &metadata_output,
        &crawclaw_gateway::gateway_protocol_metadata_ts(),
        "metadata",
    )?;
    if let Some(schema_ts_output) = schema_ts_output {
        write_protocol_artifact(
            &schema_ts_output,
            &crawclaw_gateway::gateway_protocol_schema_ts()?,
            "typescript schema",
        )?;
    }
    Ok(())
}

fn write_protocol_artifact(output: &PathBuf, contents: &str, label: &str) -> Result<(), String> {
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create protocol {label} output dir {}: {error}",
                parent.display()
            )
        })?;
    }
    std::fs::write(output, contents).map_err(|error| {
        format!(
            "failed to write protocol {label} artifact {}: {error}",
            output.display()
        )
    })?;
    println!("wrote {}", output.display());
    Ok(())
}

async fn call_gateway_method(args: Vec<String>) -> Result<(), String> {
    let mut method: Option<String> = None;
    let mut params = serde_json::Value::Object(serde_json::Map::new());
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--method" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("--method requires a value".to_string());
                };
                method = Some(value.clone());
                index += 2;
            }
            "--params-json" => {
                let Some(value) = args.get(index + 1) else {
                    return Err("--params-json requires a value".to_string());
                };
                params = serde_json::from_str(value)
                    .map_err(|error| format!("invalid --params-json: {error}"))?;
                index += 2;
            }
            other => return Err(format!("unsupported call option: {other}")),
        }
    }
    let method = method.ok_or_else(|| "--method is required".to_string())?;
    let value = call_local_gateway_method(&method, params).await?;
    let raw =
        serde_json::to_string(&value).map_err(|error| format!("failed to encode JSON: {error}"))?;
    println!("{raw}");
    Ok(())
}

fn parse_bind(value: &str) -> GatewayBind {
    match value {
        "127.0.0.1" | "localhost" | "loopback" => GatewayBind::Loopback,
        "0.0.0.0" | "lan" => GatewayBind::Lan,
        _ => exit_usage("--bind must be 127.0.0.1, localhost, loopback, 0.0.0.0, or lan"),
    }
}

fn exit_usage(message: &str) -> ! {
    eprintln!("{message}");
    print_help();
    std::process::exit(2);
}

fn print_help() {
    println!(
        "Usage: crawclaw-gateway [--bind 127.0.0.1|0.0.0.0] [--port PORT] [--runtime-root PATH] | call --method <name> [--params-json JSON] | emit-protocol-schema --output <path> | emit-protocol-artifacts --schema-output <path> --metadata-output <path>"
    );
}
