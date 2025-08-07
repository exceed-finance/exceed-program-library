import { createFromRoot, getAllPrograms, programNode, deleteNodesVisitor, updateProgramsVisitor, updateDefinedTypesVisitor } from "codama";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderJavaScriptUmiVisitor, renderRustVisitor } from "@codama/renderers";
import * as fs from 'fs';

const generateClients = async () => {
    // Read IDL files
    const earlyPurchaseIDL = JSON.parse(fs.readFileSync("target/idl/early_purchase.json", "utf-8"));
    const liquidStakingIDL = JSON.parse(fs.readFileSync("target/idl/liquid_staking.json", "utf-8"));

    // Create Codama instances
    const liquidStakingCodama = createFromRoot(rootNodeFromAnchor(liquidStakingIDL));
    const earlyPurchaseCodama = createFromRoot(rootNodeFromAnchor(earlyPurchaseIDL));

    liquidStakingCodama.update(updateProgramsVisitor({
        liquidStaking: {
            publicKey: 'par1tyqusak2f2DXg9RHv78SVHNWXkJLSbtJZQSuWjV'
        }
    }))
    liquidStakingCodama.update(deleteNodesVisitor(['[accountNode]priceUpdateV2', '[definedTypeNode]verificationLevel']))

    earlyPurchaseCodama.update(updateProgramsVisitor({
        earlyPurchase: {
            publicKey: 'EmzVeKtVHRc6AuzrJtowoJ5qfEkpK1R9WzAmcnjzgF1V'
        }
    }))
    earlyPurchaseCodama.update(deleteNodesVisitor(['[accountNode]priceUpdateV2', '[definedTypeNode]verificationLevel']))


    // Ensure output directories exist
    fs.mkdirSync("clients/rust/generated/liquid_staking", { recursive: true });
    fs.mkdirSync("clients/js/src/generated/liquid_staking", { recursive: true });
    fs.mkdirSync("clients/rust/generated/early_purchase", { recursive: true });
    fs.mkdirSync("clients/js/src/generated/early_purchase", { recursive: true });

    // Generate clients
    liquidStakingCodama.accept(renderRustVisitor("clients/rust/generated/liquid_staking"));
    liquidStakingCodama.accept(renderJavaScriptUmiVisitor("clients/js/src/generated/liquid_staking"));

    earlyPurchaseCodama.accept(renderRustVisitor("clients/rust/generated/early_purchase"));
    earlyPurchaseCodama.accept(renderJavaScriptUmiVisitor("clients/js/src/generated/early_purchase"));
}

generateClients().then(() => {
    console.log("Clients generated successfully");
}).catch((error) => {
    console.error("Error generating clients:", error);
    process.exit(1);
});
