public class Objects {
    static class Counter {
        int value;

        Counter(int value) {
            this.value = value;
        }

        void increment() {
            value++;
        }
    }

    public static void main(String[] args) {
        Counter counter = new Counter(4);
        counter.increment();
        try {
            int[] values = {counter.value};
            System.out.println(values[2]);
        } catch (ArrayIndexOutOfBoundsException error) {
            System.out.println("caught: " + error.getClass().getSimpleName());
        }
    }
}

// Expected output: caught: ArrayIndexOutOfBoundsException
