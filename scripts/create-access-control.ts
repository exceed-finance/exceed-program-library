import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { createSignerFromKeypair, signerIdentity, } from "@metaplex-foundation/umi";
import { LiquidStaking } from "../clients/js/src";
import { findAccessControlPda } from "../clients/js/src";
import * as fs from "fs";


async function main() {
    console.log(LiquidStaking.LIQUID_STAKING_PROGRAM_ID.toString())
    // 1. Set up UMI for mainnet with placeholder RPC URL
    const MAINNET_RPC_URL = "REPLACE_ME"; // Replace with your preferred RPC URL
    const umi = createUmi(MAINNET_RPC_URL)
    umi.programs.add(LiquidStaking.createLiquidStakingProgram());

    // 2. Load the admin keypair (must match FIRST_ADMIN in the Rust code)
    // In the Rust code, FIRST_ADMIN is set to: "NiLzqeKXPxVsbFjDVvSWNxrAv1xebfVaqgw7g5qgzxb"
    // You'll need to replace this with the actual keypair file
    const adminKeypairPath = "/mnt/nugget/keys/nil/n1.json"; // Replace with actual path
    const adminKeypairData = JSON.parse(fs.readFileSync(adminKeypairPath, "utf-8"));
    const adminKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(adminKeypairData));
    const adminSigner = createSignerFromKeypair(umi, adminKeypair);

    // 3. Set identity for transactions
    umi.use(signerIdentity(adminSigner));

    // 4. Define authority keypairs (replace these with your actual keypairs)
    const vaultAuthorityPath = "REPLACE_ME"; // Replace with actual path
    const windowAuthorityPath = "REPLACE_ME"; // Replace with actual path
    const depositAuthorityPath = "REPLACE_ME"; // Replace with actual path
    const pairAuthorityPath = "REPLACE_ME"; // Replace with actual path
    const unsealAuthorityPath = "REPLACE_ME"; // Replace with actual path
    const accessAuthorityPath = "REPLACE_ME"; // Replace with actual path
    const navAuthorityPath = "REPLACE_ME"; // Replace with actual path

    // Load keypairs and convert to UMI keypairs
    const vaultAuthorityKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(vaultAuthorityPath, "utf-8"))));
    const windowAuthorityKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(windowAuthorityPath, "utf-8"))));
    const depositAuthorityKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(depositAuthorityPath, "utf-8"))));
    const pairAuthorityKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(pairAuthorityPath, "utf-8"))));
    const unsealAuthorityKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(unsealAuthorityPath, "utf-8"))));
    const accessAuthorityKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(accessAuthorityPath, "utf-8"))));
    const navAuthorityKeypair = umi.eddsa.createKeypairFromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(navAuthorityPath, "utf-8"))));

    // Create UMI signers
    const vaultAuthority = createSignerFromKeypair(umi, vaultAuthorityKeypair);
    const windowAuthority = createSignerFromKeypair(umi, windowAuthorityKeypair);
    const depositAuthority = createSignerFromKeypair(umi, depositAuthorityKeypair);
    const pairAuthority = createSignerFromKeypair(umi, pairAuthorityKeypair);
    const unsealAuthority = createSignerFromKeypair(umi, unsealAuthorityKeypair);
    const accessAuthority = createSignerFromKeypair(umi, accessAuthorityKeypair);
    const navAuthority = createSignerFromKeypair(umi, navAuthorityKeypair);

    // 5. Find the access control PDA
    const [accessControlAddress] = findAccessControlPda(umi);
    console.log("Access Control Address:", accessControlAddress.toString());

    // 6. Create and execute the transaction
    console.log("Creating access control account...");

    const { signature, result } = await LiquidStaking.createAccessControl(umi, {
        accessControl: accessControlAddress,
        admin: adminSigner,
        vaultAuthority: vaultAuthority.publicKey,
        windowAuthority: windowAuthority.publicKey,
        depositAuthority: depositAuthority.publicKey,
        pairAuthority: pairAuthority.publicKey,
        unsealAuthority: unsealAuthority.publicKey,
        accessAuthority: accessAuthority.publicKey,
        navAuthority: navAuthority.publicKey
    }).sendAndConfirm(umi);

    // 7. Send the transaction
    console.log("Transaction sent with signature:", signature);
    console.log("Result:", result);

    // fetch the access control account to prove it worked.
    const accessControl = await LiquidStaking.fetchAccessControl(umi, accessControlAddress);

    console.log("Access Control Account created successfully:");
    console.log(accessControl);

}

// Run the function
main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
