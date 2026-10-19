import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.lang.reflect.*;
import java.util.*;

public final class CodeFlowTarget {
    public static volatile String stdout = "", stderr = "", failureType = "";
    public static volatile boolean outputLimited = false;
    private static final int OUTPUT_LIMIT = 32768;
    private static final class OutputLimit extends Error { private static final long serialVersionUID=1L; }
    private static final class Capture extends OutputStream {
        private final boolean error;
        private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        Capture(boolean error) { this.error = error; }
        @Override public synchronized void write(int value) throws IOException { write(new byte[]{(byte)value},0,1); }
        @Override public synchronized void write(byte[] value,int offset,int length) throws IOException {
            if (bytes.size()+length>OUTPUT_LIMIT) {
                outputLimited=true;
                throw new OutputLimit();
            }
            bytes.write(value,offset,length);
            String text=bytes.toString(StandardCharsets.UTF_8);
            if(error) stderr=text; else stdout=text;
        }
    }
    public static void main(String[] args) throws Exception {
        System.setIn(Files.newInputStream(Path.of(args[1])));
        System.setOut(new PrintStream(new Capture(false),true,StandardCharsets.UTF_8));
        System.setErr(new PrintStream(new Capture(true),true,StandardCharsets.UTF_8));
        String[] targetArgs=Files.readAllLines(Path.of(args[2]),StandardCharsets.UTF_8).stream()
            .map(s->new String(Base64.getDecoder().decode(s),StandardCharsets.UTF_8)).toArray(String[]::new);
        try {
            Class.forName(args[0]).getMethod("main",String[].class).invoke(null,(Object)targetArgs);
        } catch(InvocationTargetException ex) {
            failureType=ex.getCause().getClass().getName();
        } catch(Throwable ex) {
            failureType=ex.getClass().getName();
        } finally {
            finish();
        }
    }
    public static void finish() { /* Debugger observes this boundary before VM exit. */ }
}
