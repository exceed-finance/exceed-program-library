FROM ubuntu:plucky
RUN apt-get update && apt-get install -qy git gnutls-bin curl

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Rust using rustup in non-interactive mode
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

RUN curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
ENV PATH="/root/.local/share/solana/install/active_release/bin:$PATH"

RUN cargo install --git https://github.com/coral-xyz/anchor avm --force

RUN avm install 0.30.1
RUN avm use 0.30.1


WORKDIR /build
CMD /bin/bash