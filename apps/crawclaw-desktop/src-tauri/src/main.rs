fn main() {
    let mut args = std::env::args().skip(1).collect::<Vec<_>>();
    if args
        .first()
        .is_some_and(|arg| arg == "emit-desktop-api-contract")
    {
        args.remove(0);
        emit_desktop_api_contract(args);
        return;
    }

    crawclaw_desktop::run()
}

fn emit_desktop_api_contract(args: Vec<String>) {
    let mut output = None;
    let mut check = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--check" => {
                check = true;
                index += 1;
            }
            "--write" => {
                index += 1;
            }
            "--output" => {
                let Some(value) = args.get(index + 1) else {
                    eprintln!("--output requires a value");
                    std::process::exit(2);
                };
                output = Some(std::path::PathBuf::from(value));
                index += 2;
            }
            other => {
                eprintln!("unsupported emit-desktop-api-contract option: {other}");
                std::process::exit(2);
            }
        }
    }

    let Some(output_path) = output else {
        eprintln!(
            "usage: crawclaw-desktop emit-desktop-api-contract --output <path> [--check|--write]"
        );
        std::process::exit(2);
    };

    match crawclaw_desktop::desktop_contract::write_desktop_api_contract(&output_path, check) {
        Ok(result) => {
            if check {
                if result.changed {
                    eprintln!(
                        "[desktop-api-contract] stale generated output at {}",
                        result.output_path.display()
                    );
                    std::process::exit(1);
                }
            } else if result.wrote {
                println!(
                    "[desktop-api-contract] wrote {}",
                    result.output_path.display()
                );
            }
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
