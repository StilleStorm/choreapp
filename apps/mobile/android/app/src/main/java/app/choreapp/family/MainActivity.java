package app.choreapp.family;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;

public class MainActivity extends BridgeActivity {

    @Override
    @SuppressWarnings("unchecked")
    public void onCreate(Bundle savedInstanceState) {
        // The self-updater (src/sideload) exists only in the sideloaded build, never in the Play build.
        try {
            registerPlugin((Class<? extends Plugin>) Class.forName("app.choreapp.family.AppUpdaterPlugin"));
        } catch (ClassNotFoundException ignored) {
            // Google Play / staging build: updates come from the store.
        }
        super.onCreate(savedInstanceState);
    }
}
